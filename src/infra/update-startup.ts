import fs from "node:fs/promises";
import path from "node:path";
import type { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { VERSION } from "../version.js";
import { writeJsonAtomic } from "./json-files.js";
import { resolveOpenClawPackageRoot } from "./openclaw-root.js";
import { normalizeUpdateChannel, DEFAULT_PACKAGE_CHANNEL } from "./update-channels.js";
import {
  compareSemverStrings,
  checkUpdateStatus,
  fetchForkLatestRelease,
  FORK_CURRENT_TAG,
} from "./update-check.js";

type UpdateCheckState = {
  lastCheckedAt?: string;
  lastNotifiedVersion?: string;
  lastNotifiedTag?: string;
  lastAvailableVersion?: string;
  lastAvailableTag?: string;
  autoInstallId?: string;
  autoFirstSeenVersion?: string;
  autoFirstSeenTag?: string;
  autoFirstSeenAt?: string;
  autoLastAttemptVersion?: string;
  autoLastAttemptAt?: string;
  autoLastSuccessVersion?: string;
  autoLastSuccessAt?: string;
};

type AutoUpdatePolicy = {
  enabled: boolean;
  stableDelayHours: number;
  stableJitterHours: number;
  betaCheckIntervalHours: number;
};

export type UpdateAvailable = {
  currentVersion: string;
  latestVersion: string;
  channel: string;
};

let updateAvailableCache: UpdateAvailable | null = null;

export function getUpdateAvailable(): UpdateAvailable | null {
  return updateAvailableCache;
}

export function resetUpdateAvailableStateForTest(): void {
  updateAvailableCache = null;
}

const UPDATE_CHECK_FILENAME = "update-check.json";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const AUTO_STABLE_DELAY_HOURS_DEFAULT = 6;
const AUTO_STABLE_JITTER_HOURS_DEFAULT = 12;
const AUTO_BETA_CHECK_INTERVAL_HOURS_DEFAULT = 1;

function shouldSkipCheck(allowInTests: boolean): boolean {
  if (allowInTests) {
    return false;
  }
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return true;
  }
  return false;
}

function resolveAutoUpdatePolicy(cfg: ReturnType<typeof loadConfig>): AutoUpdatePolicy {
  const auto = cfg.update?.auto;
  const stableDelayHours =
    typeof auto?.stableDelayHours === "number" && Number.isFinite(auto.stableDelayHours)
      ? Math.max(0, auto.stableDelayHours)
      : AUTO_STABLE_DELAY_HOURS_DEFAULT;
  const stableJitterHours =
    typeof auto?.stableJitterHours === "number" && Number.isFinite(auto.stableJitterHours)
      ? Math.max(0, auto.stableJitterHours)
      : AUTO_STABLE_JITTER_HOURS_DEFAULT;
  const betaCheckIntervalHours =
    typeof auto?.betaCheckIntervalHours === "number" && Number.isFinite(auto.betaCheckIntervalHours)
      ? Math.max(0.25, auto.betaCheckIntervalHours)
      : AUTO_BETA_CHECK_INTERVAL_HOURS_DEFAULT;

  return {
    enabled: Boolean(auto?.enabled),
    stableDelayHours,
    stableJitterHours,
    betaCheckIntervalHours,
  };
}

function resolveCheckIntervalMs(cfg: ReturnType<typeof loadConfig>): number {
  const channel = normalizeUpdateChannel(cfg.update?.channel) ?? DEFAULT_PACKAGE_CHANNEL;
  const auto = resolveAutoUpdatePolicy(cfg);
  if (!auto.enabled) {
    return UPDATE_CHECK_INTERVAL_MS;
  }
  if (channel === "beta") {
    return Math.max(ONE_HOUR_MS / 4, Math.floor(auto.betaCheckIntervalHours * ONE_HOUR_MS));
  }
  if (channel === "stable") {
    return ONE_HOUR_MS;
  }
  return UPDATE_CHECK_INTERVAL_MS;
}

async function readState(statePath: string): Promise<UpdateCheckState> {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as UpdateCheckState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeState(statePath: string, state: UpdateCheckState): Promise<void> {
  await writeJsonAtomic(statePath, state);
}

function sameUpdateAvailable(a: UpdateAvailable | null, b: UpdateAvailable | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.currentVersion === b.currentVersion &&
    a.latestVersion === b.latestVersion &&
    a.channel === b.channel
  );
}

function setUpdateAvailableCache(params: {
  next: UpdateAvailable | null;
  onUpdateAvailableChange?: (updateAvailable: UpdateAvailable | null) => void;
}): void {
  if (sameUpdateAvailable(updateAvailableCache, params.next)) {
    return;
  }
  updateAvailableCache = params.next;
  params.onUpdateAvailableChange?.(params.next);
}

function resolvePersistedUpdateAvailable(state: UpdateCheckState): UpdateAvailable | null {
  const latestVersion = state.lastAvailableVersion?.trim();
  if (!latestVersion) {
    return null;
  }
  const cmp = compareSemverStrings(VERSION, latestVersion);
  if (cmp == null || cmp >= 0) {
    return null;
  }
  const channel = state.lastAvailableTag?.trim() || DEFAULT_PACKAGE_CHANNEL;
  return {
    currentVersion: VERSION,
    latestVersion,
    channel,
  };
}

function clearAutoState(nextState: UpdateCheckState): void {
  delete nextState.autoFirstSeenVersion;
  delete nextState.autoFirstSeenTag;
  delete nextState.autoFirstSeenAt;
}

export async function runGatewayUpdateCheck(params: {
  cfg: ReturnType<typeof loadConfig>;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void };
  isNixMode: boolean;
  allowInTests?: boolean;
  onUpdateAvailableChange?: (updateAvailable: UpdateAvailable | null) => void;
}): Promise<void> {
  if (shouldSkipCheck(Boolean(params.allowInTests))) {
    return;
  }
  if (params.isNixMode) {
    return;
  }
  const auto = resolveAutoUpdatePolicy(params.cfg);
  const shouldRunUpdateHints = params.cfg.update?.checkOnStart !== false;
  if (!shouldRunUpdateHints && !auto.enabled) {
    return;
  }

  const statePath = path.join(resolveStateDir(), UPDATE_CHECK_FILENAME);
  const state = await readState(statePath);
  const now = Date.now();
  const lastCheckedAt = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : null;
  if (shouldRunUpdateHints) {
    const persistedAvailable = resolvePersistedUpdateAvailable(state);
    setUpdateAvailableCache({
      next: persistedAvailable,
      onUpdateAvailableChange: params.onUpdateAvailableChange,
    });
  } else {
    setUpdateAvailableCache({
      next: null,
      onUpdateAvailableChange: params.onUpdateAvailableChange,
    });
  }
  const checkIntervalMs = resolveCheckIntervalMs(params.cfg);
  if (lastCheckedAt && Number.isFinite(lastCheckedAt)) {
    if (now - lastCheckedAt < checkIntervalMs) {
      return;
    }
  }

  const root = await resolveOpenClawPackageRoot({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });
  const status = await checkUpdateStatus({
    root,
    timeoutMs: 2500,
    fetchGit: false,
    includeRegistry: false,
  });

  const nextState: UpdateCheckState = {
    ...state,
    lastCheckedAt: new Date(now).toISOString(),
  };

  // --- Tianjun Fork: check GitHub releases instead of npm ---
  // Skip npm check entirely; only check fork's GitHub releases.
  if (status.installKind !== "package") {
    // git install: skip update check (dev mode)
    delete nextState.lastAvailableVersion;
    delete nextState.lastAvailableTag;
    clearAutoState(nextState);
    setUpdateAvailableCache({
      next: null,
      onUpdateAvailableChange: params.onUpdateAvailableChange,
    });
    await writeState(statePath, nextState);
    return;
  }

  const forkRelease = await fetchForkLatestRelease({ timeoutMs: 3500 });
  if (!forkRelease.tag) {
    await writeState(statePath, nextState);
    return;
  }

  if (forkRelease.tag !== FORK_CURRENT_TAG) {
    const nextAvailable: UpdateAvailable = {
      currentVersion: FORK_CURRENT_TAG,
      latestVersion: forkRelease.tag,
      channel: "fork",
    };
    if (shouldRunUpdateHints) {
      setUpdateAvailableCache({
        next: nextAvailable,
        onUpdateAvailableChange: params.onUpdateAvailableChange,
      });
    }
    nextState.lastAvailableVersion = forkRelease.tag;
    nextState.lastAvailableTag = "fork";
    const shouldNotify = state.lastNotifiedVersion !== forkRelease.tag;
    if (shouldRunUpdateHints && shouldNotify) {
      params.log.info(
        `fork update available: ${forkRelease.tag} (current ${FORK_CURRENT_TAG}). See: https://github.com/DexterSLamb/openclaw-tianjun/releases`,
      );
      nextState.lastNotifiedVersion = forkRelease.tag;
      nextState.lastNotifiedTag = "fork";
    }
  } else {
    delete nextState.lastAvailableVersion;
    delete nextState.lastAvailableTag;
    clearAutoState(nextState);
    setUpdateAvailableCache({
      next: null,
      onUpdateAvailableChange: params.onUpdateAvailableChange,
    });
  }

  await writeState(statePath, nextState);
}

export function scheduleGatewayUpdateCheck(params: {
  cfg: ReturnType<typeof loadConfig>;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void };
  isNixMode: boolean;
  onUpdateAvailableChange?: (updateAvailable: UpdateAvailable | null) => void;
}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const tick = async () => {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      await runGatewayUpdateCheck(params);
    } catch {
      // Intentionally ignored: update checks should never crash the gateway loop.
    } finally {
      running = false;
    }
    if (stopped) {
      return;
    }
    const intervalMs = resolveCheckIntervalMs(params.cfg);
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
