import { format } from "node:util";
import {
  GROUP_POLICY_BLOCKED_LABEL,
  mergeAllowlist,
  resolveThreadBindingIdleTimeoutMsForChannel,
  resolveThreadBindingMaxAgeMsForChannel,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  summarizeMapping,
  warnMissingProviderGroupPolicyFallbackOnce,
  type RuntimeEnv,
} from "openclaw/plugin-sdk/matrix";
import { resolveMatrixTargets } from "../../resolve-targets.js";
import { getMatrixRuntime } from "../../runtime.js";
import type { CoreConfig, ReplyToMode } from "../../types.js";
import { resolveMatrixAccount } from "../accounts.js";
import { setActiveMatrixClient } from "../active-client.js";
import {
  isBunRuntime,
  resolveMatrixAuth,
  resolveSharedMatrixClient,
  stopSharedClientForAccount,
} from "../client.js";
import { updateMatrixAccountConfig } from "../config-update.js";
import { syncMatrixOwnProfile } from "../profile.js";
import { createMatrixThreadBindingManager } from "../thread-bindings.js";
import { normalizeMatrixUserId } from "./allowlist.js";
import { registerMatrixAutoJoin } from "./auto-join.js";
import { createDirectRoomTracker } from "./direct.js";
import { registerMatrixMonitorEvents } from "./events.js";
import { createMatrixRoomMessageHandler } from "./handler.js";
import { maybeRestoreLegacyMatrixBackup } from "./legacy-crypto-restore.js";
import { createMatrixRoomInfoResolver } from "./room-info.js";
import { ensureMatrixStartupVerification } from "./startup-verification.js";

export type MonitorMatrixOpts = {
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  mediaMaxMb?: number;
  initialSyncLimit?: number;
  replyToMode?: ReplyToMode;
  accountId?: string | null;
};

const DEFAULT_MEDIA_MAX_MB = 20;

export async function monitorMatrixProvider(opts: MonitorMatrixOpts = {}): Promise<void> {
  if (isBunRuntime()) {
    throw new Error("Matrix provider requires Node (bun runtime not supported)");
  }
  const core = getMatrixRuntime();
  let cfg = core.config.loadConfig() as CoreConfig;
  if (cfg.channels?.["matrix"]?.enabled === false) {
    return;
  }

  const logger = core.logging.getChildLogger({ module: "matrix-auto-reply" });
  const formatRuntimeMessage = (...args: Parameters<RuntimeEnv["log"]>) => format(...args);
  const runtime: RuntimeEnv = opts.runtime ?? {
    log: (...args) => {
      logger.info(formatRuntimeMessage(...args));
    },
    error: (...args) => {
      logger.error(formatRuntimeMessage(...args));
    },
    exit: (code: number): never => {
      throw new Error(`exit ${code}`);
    },
  };
  const logVerboseMessage = (message: string) => {
    if (!core.logging.shouldLogVerbose()) {
      return;
    }
    logger.debug?.(message);
  };

  const normalizeUserEntry = (raw: string) =>
    raw
      .replace(/^matrix:/i, "")
      .replace(/^user:/i, "")
      .trim();
  const normalizeRoomEntry = (raw: string) =>
    raw
      .replace(/^matrix:/i, "")
      .replace(/^(room|channel):/i, "")
      .trim();
  const isMatrixUserId = (value: string) => value.startsWith("@") && value.includes(":");
  const resolveUserAllowlist = async (
    label: string,
    list?: Array<string | number>,
  ): Promise<string[]> => {
    let allowList = list ?? [];
    if (allowList.length === 0) {
      return allowList.map(String);
    }
    const entries = allowList
      .map((entry) => normalizeUserEntry(String(entry)))
      .filter((entry) => entry && entry !== "*");
    if (entries.length === 0) {
      return allowList.map(String);
    }
    const mapping: string[] = [];
    const unresolved: string[] = [];
    const additions: string[] = [];
    const pending: string[] = [];
    for (const entry of entries) {
      if (isMatrixUserId(entry)) {
        additions.push(normalizeMatrixUserId(entry));
        continue;
      }
      pending.push(entry);
    }
    if (pending.length > 0) {
      const resolved = await resolveMatrixTargets({
        cfg,
        inputs: pending,
        kind: "user",
        runtime,
      });
      for (const entry of resolved) {
        if (entry.resolved && entry.id) {
          const normalizedId = normalizeMatrixUserId(entry.id);
          additions.push(normalizedId);
          mapping.push(`${entry.input}→${normalizedId}`);
        } else {
          unresolved.push(entry.input);
        }
      }
    }
    allowList = mergeAllowlist({ existing: allowList, additions });
    summarizeMapping(label, mapping, unresolved, runtime);
    if (unresolved.length > 0) {
      runtime.log?.(
        `${label} entries must be full Matrix IDs (example: @user:server). Unresolved entries are ignored.`,
      );
    }
    return allowList.map(String);
  };

  // Resolve account-specific config for multi-account support
  const account = resolveMatrixAccount({ cfg, accountId: opts.accountId });
  const accountConfig = account.config;

  const allowlistOnly = accountConfig.allowlistOnly === true;
  let allowFrom: string[] = (accountConfig.dm?.allowFrom ?? []).map(String);
  let groupAllowFrom: string[] = (accountConfig.groupAllowFrom ?? []).map(String);
  let roomsConfig = accountConfig.groups ?? accountConfig.rooms;

  allowFrom = await resolveUserAllowlist("matrix dm allowlist", allowFrom);
  groupAllowFrom = await resolveUserAllowlist("matrix group allowlist", groupAllowFrom);

  if (roomsConfig && Object.keys(roomsConfig).length > 0) {
    const mapping: string[] = [];
    const unresolved: string[] = [];
    const nextRooms: Record<string, (typeof roomsConfig)[string]> = {};
    if (roomsConfig["*"]) {
      nextRooms["*"] = roomsConfig["*"];
    }
    const pending: Array<{ input: string; query: string; config: (typeof roomsConfig)[string] }> =
      [];
    for (const [entry, roomConfig] of Object.entries(roomsConfig)) {
      if (entry === "*") {
        continue;
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      const cleaned = normalizeRoomEntry(trimmed);
      if ((cleaned.startsWith("!") || cleaned.startsWith("#")) && cleaned.includes(":")) {
        if (!nextRooms[cleaned]) {
          nextRooms[cleaned] = roomConfig;
        }
        if (cleaned !== entry) {
          mapping.push(`${entry}→${cleaned}`);
        }
        continue;
      }
      pending.push({ input: entry, query: trimmed, config: roomConfig });
    }
    if (pending.length > 0) {
      const resolved = await resolveMatrixTargets({
        cfg,
        inputs: pending.map((entry) => entry.query),
        kind: "group",
        runtime,
      });
      resolved.forEach((entry, index) => {
        const source = pending[index];
        if (!source) {
          return;
        }
        if (entry.resolved && entry.id) {
          if (!nextRooms[entry.id]) {
            nextRooms[entry.id] = source.config;
          }
          mapping.push(`${source.input}→${entry.id}`);
        } else {
          unresolved.push(source.input);
        }
      });
    }
    roomsConfig = nextRooms;
    summarizeMapping("matrix rooms", mapping, unresolved, runtime);
    if (unresolved.length > 0) {
      runtime.log?.(
        "matrix rooms must be room IDs or aliases (example: !room:server or #alias:server). Unresolved entries are ignored.",
      );
    }
  }
  if (roomsConfig && Object.keys(roomsConfig).length > 0) {
    const nextRooms = { ...roomsConfig };
    for (const [roomKey, roomConfig] of Object.entries(roomsConfig)) {
      const users = roomConfig?.users ?? [];
      if (users.length === 0) {
        continue;
      }
      const resolvedUsers = await resolveUserAllowlist(`matrix room users (${roomKey})`, users);
      if (resolvedUsers !== users) {
        nextRooms[roomKey] = { ...roomConfig, users: resolvedUsers };
      }
    }
    roomsConfig = nextRooms;
  }

  cfg = {
    ...cfg,
    channels: {
      ...cfg.channels,
      matrix: {
        ...cfg.channels?.["matrix"],
        dm: {
          ...cfg.channels?.["matrix"]?.dm,
          allowFrom,
        },
        groupAllowFrom,
        ...(roomsConfig ? { groups: roomsConfig } : {}),
      },
    },
  };

  const auth = await resolveMatrixAuth({ cfg, accountId: opts.accountId });
  const resolvedInitialSyncLimit =
    typeof opts.initialSyncLimit === "number"
      ? Math.max(0, Math.floor(opts.initialSyncLimit))
      : auth.initialSyncLimit;
  const authWithLimit =
    resolvedInitialSyncLimit === auth.initialSyncLimit
      ? auth
      : { ...auth, initialSyncLimit: resolvedInitialSyncLimit };
  const client = await resolveSharedMatrixClient({
    cfg,
    auth: authWithLimit,
    startClient: false,
    accountId: opts.accountId ?? undefined,
  });
  setActiveMatrixClient(client, opts.accountId);

  const mentionRegexes = core.channel.mentions.buildMentionRegexes(cfg);
  const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
  const { groupPolicy: groupPolicyRaw, providerMissingFallbackApplied } =
    resolveAllowlistProviderRuntimeGroupPolicy({
      providerConfigPresent: cfg.channels?.["matrix"] !== undefined,
      groupPolicy: accountConfig.groupPolicy,
      defaultGroupPolicy,
    });
  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: "matrix",
    accountId: account.accountId,
    blockedLabel: GROUP_POLICY_BLOCKED_LABEL.room,
    log: (message) => logVerboseMessage(message),
  });
  const groupPolicy = allowlistOnly && groupPolicyRaw === "open" ? "allowlist" : groupPolicyRaw;
  const replyToMode = opts.replyToMode ?? accountConfig.replyToMode ?? "off";
  const threadReplies = accountConfig.threadReplies ?? "inbound";
  const threadBindingIdleTimeoutMs = resolveThreadBindingIdleTimeoutMsForChannel({
    cfg,
    channel: "matrix",
    accountId: account.accountId,
  });
  const threadBindingMaxAgeMs = resolveThreadBindingMaxAgeMsForChannel({
    cfg,
    channel: "matrix",
    accountId: account.accountId,
  });
  const dmConfig = accountConfig.dm;
  const dmEnabled = dmConfig?.enabled ?? true;
  const dmPolicyRaw = dmConfig?.policy ?? "pairing";
  const dmPolicy = allowlistOnly && dmPolicyRaw !== "disabled" ? "allowlist" : dmPolicyRaw;
  const textLimit = core.channel.text.resolveTextChunkLimit(cfg, "matrix");
  const mediaMaxMb = opts.mediaMaxMb ?? accountConfig.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB;
  const mediaMaxBytes = Math.max(1, mediaMaxMb) * 1024 * 1024;
  const startupMs = Date.now();
  const startupGraceMs = 0;
  const directTracker = createDirectRoomTracker(client, { log: logVerboseMessage });
  registerMatrixAutoJoin({ client, cfg, runtime });
  const warnedEncryptedRooms = new Set<string>();
  const warnedCryptoMissingRooms = new Set<string>();

  const { getRoomInfo, getMemberDisplayName } = createMatrixRoomInfoResolver(client);
  const handleRoomMessage = createMatrixRoomMessageHandler({
    client,
    core,
    cfg,
    accountId: account.accountId,
    runtime,
    logger,
    logVerboseMessage,
    allowFrom,
    roomsConfig,
    mentionRegexes,
    groupPolicy,
    replyToMode,
    threadReplies,
    dmEnabled,
    dmPolicy,
    textLimit,
    mediaMaxBytes,
    startupMs,
    startupGraceMs,
    directTracker,
    getRoomInfo,
    getMemberDisplayName,
  });

  registerMatrixMonitorEvents({
    client,
    auth,
    logVerboseMessage,
    warnedEncryptedRooms,
    warnedCryptoMissingRooms,
    logger,
    formatNativeDependencyHint: core.system.formatNativeDependencyHint,
    onRoomMessage: handleRoomMessage,
  });

  logVerboseMessage("matrix: starting client");
  await resolveSharedMatrixClient({
    cfg,
    auth: authWithLimit,
    accountId: opts.accountId,
  });
  logVerboseMessage("matrix: client started");
  const threadBindingManager = await createMatrixThreadBindingManager({
    accountId: account.accountId,
    auth,
    client,
    env: process.env,
    idleTimeoutMs: threadBindingIdleTimeoutMs,
    maxAgeMs: threadBindingMaxAgeMs,
    logVerboseMessage,
  });
  logVerboseMessage(
    `matrix: thread bindings ready account=${threadBindingManager.accountId} idleMs=${threadBindingIdleTimeoutMs} maxAgeMs=${threadBindingMaxAgeMs}`,
  );

  // Shared client is already started via resolveSharedMatrixClient.
  logger.info(`matrix: logged in as ${auth.userId}`);

  try {
    const profileSync = await syncMatrixOwnProfile({
      client,
      userId: auth.userId,
      displayName: accountConfig.name,
      avatarUrl: accountConfig.avatarUrl,
      loadAvatarFromUrl: async (url, maxBytes) => await core.media.loadWebMedia(url, maxBytes),
    });
    if (profileSync.displayNameUpdated) {
      logger.info(`matrix: profile display name updated for ${auth.userId}`);
    }
    if (profileSync.avatarUpdated) {
      logger.info(`matrix: profile avatar updated for ${auth.userId}`);
    }
    if (
      profileSync.convertedAvatarFromHttp &&
      profileSync.resolvedAvatarUrl &&
      accountConfig.avatarUrl !== profileSync.resolvedAvatarUrl
    ) {
      const latestCfg = core.config.loadConfig() as CoreConfig;
      const updatedCfg = updateMatrixAccountConfig(latestCfg, account.accountId, {
        avatarUrl: profileSync.resolvedAvatarUrl,
      });
      await core.config.writeConfigFile(updatedCfg as never);
      logVerboseMessage(
        `matrix: persisted converted avatar URL for account ${account.accountId} (${profileSync.resolvedAvatarUrl})`,
      );
    }
  } catch (err) {
    logger.warn("matrix: failed to sync profile from config", { error: String(err) });
  }

  // If E2EE is enabled, report device verification status and request self-verification
  // when configured and the device is still unverified.
  if (auth.encryption && client.crypto) {
    try {
      const startupVerification = await ensureMatrixStartupVerification({
        client,
        auth,
        accountConfig,
        accountId: account.accountId,
        env: process.env,
      });
      if (startupVerification.kind === "verified") {
        logger.info("matrix: device is verified and ready for encrypted rooms");
      } else if (
        startupVerification.kind === "disabled" ||
        startupVerification.kind === "cooldown" ||
        startupVerification.kind === "pending" ||
        startupVerification.kind === "request-failed"
      ) {
        logger.info(
          "matrix: device not verified — run 'openclaw matrix verify device <key>' to enable E2EE",
        );
        if (startupVerification.kind === "pending") {
          logger.info(
            "matrix: startup verification request is already pending; finish it in another Matrix client",
          );
        } else if (startupVerification.kind === "cooldown") {
          logVerboseMessage(
            `matrix: skipped startup verification request due to cooldown (retryAfterMs=${startupVerification.retryAfterMs ?? 0})`,
          );
        } else if (startupVerification.kind === "request-failed") {
          logger.debug?.("Matrix startup verification request failed (non-fatal)", {
            error: startupVerification.error ?? "unknown",
          });
        }
      } else if (startupVerification.kind === "requested") {
        logger.info(
          "matrix: device not verified — requested verification in another Matrix client",
        );
      }
    } catch (err) {
      logger.debug?.("Failed to resolve matrix verification status (non-fatal)", {
        error: String(err),
      });
    }

    try {
      const legacyCryptoRestore = await maybeRestoreLegacyMatrixBackup({
        client,
        auth,
        accountId: account.accountId,
        env: process.env,
      });
      if (legacyCryptoRestore.kind === "restored") {
        logger.info(
          `matrix: restored ${legacyCryptoRestore.imported}/${legacyCryptoRestore.total} room key(s) from legacy encrypted-state backup`,
        );
        if (legacyCryptoRestore.localOnlyKeys > 0) {
          logger.warn(
            `matrix: ${legacyCryptoRestore.localOnlyKeys} legacy local-only room key(s) were never backed up and could not be restored automatically`,
          );
        }
      } else if (legacyCryptoRestore.kind === "failed") {
        logger.warn(
          `matrix: failed restoring room keys from legacy encrypted-state backup: ${legacyCryptoRestore.error}`,
        );
        if (legacyCryptoRestore.localOnlyKeys > 0) {
          logger.warn(
            `matrix: ${legacyCryptoRestore.localOnlyKeys} legacy local-only room key(s) were never backed up and may remain unavailable until manually recovered`,
          );
        }
      }
    } catch (err) {
      logger.warn("matrix: failed restoring legacy encrypted-state backup", {
        error: String(err),
      });
    }
  }

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      try {
        threadBindingManager.stop();
        logVerboseMessage("matrix: stopping client");
        stopSharedClientForAccount(auth, opts.accountId);
      } finally {
        setActiveMatrixClient(null, opts.accountId);
        resolve();
      }
    };
    if (opts.abortSignal?.aborted) {
      onAbort();
      return;
    }
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}
