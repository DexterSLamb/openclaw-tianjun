import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "../routing/session-key.js";
import {
  resolveMatrixAccountStorageRoot,
  resolveMatrixCredentialsPath as resolveSharedMatrixCredentialsPath,
  resolveMatrixLegacyFlatStoragePaths,
} from "./matrix-storage-paths.js";

type MatrixStoredCredentials = {
  homeserver: string;
  userId: string;
  accessToken: string;
};

export type MatrixLegacyStateMigrationResult = {
  migrated: boolean;
  changes: string[];
  warnings: string[];
};

type MatrixLegacyStatePlan = {
  accountId: string;
  legacyStoragePath: string;
  legacyCryptoPath: string;
  targetRootDir: string;
  targetStoragePath: string;
  targetCryptoPath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveLegacyMatrixPaths(env: NodeJS.ProcessEnv): {
  rootDir: string;
  storagePath: string;
  cryptoPath: string;
} {
  const stateDir = resolveStateDir(env, os.homedir);
  return resolveMatrixLegacyFlatStoragePaths(stateDir);
}

function resolveMatrixCredentialsPath(env: NodeJS.ProcessEnv, accountId: string): string {
  const stateDir = resolveStateDir(env, os.homedir);
  return resolveSharedMatrixCredentialsPath({
    stateDir,
    accountId: normalizeAccountId(accountId),
  });
}

function loadStoredMatrixCredentials(
  env: NodeJS.ProcessEnv,
  accountId: string,
): MatrixStoredCredentials | null {
  const credentialsPath = resolveMatrixCredentialsPath(env, accountId);
  try {
    if (!fs.existsSync(credentialsPath)) {
      return null;
    }
    const parsed = JSON.parse(
      fs.readFileSync(credentialsPath, "utf-8"),
    ) as Partial<MatrixStoredCredentials>;
    if (
      typeof parsed.homeserver !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.accessToken !== "string"
    ) {
      return null;
    }
    return {
      homeserver: parsed.homeserver,
      userId: parsed.userId,
      accessToken: parsed.accessToken,
    };
  } catch {
    return null;
  }
}

function resolveMatrixChannelConfig(cfg: OpenClawConfig): Record<string, unknown> | null {
  return isRecord(cfg.channels?.matrix) ? cfg.channels.matrix : null;
}

function resolveMatrixAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): Record<string, unknown> {
  const channel = resolveMatrixChannelConfig(cfg);
  if (!channel) {
    return {};
  }

  const accounts = isRecord(channel.accounts) ? channel.accounts : null;
  const accountEntry = accounts && isRecord(accounts[accountId]) ? accounts[accountId] : null;

  const merged = {
    ...channel,
    ...accountEntry,
  };
  delete merged.accounts;
  return merged;
}

function resolveMatrixTargetAccountId(cfg: OpenClawConfig): string {
  const channel = resolveMatrixChannelConfig(cfg);
  if (!channel) {
    return DEFAULT_ACCOUNT_ID;
  }

  const accounts = isRecord(channel.accounts) ? channel.accounts : null;
  const configuredDefault = normalizeOptionalAccountId(
    typeof channel.defaultAccount === "string" ? channel.defaultAccount : undefined,
  );
  if (configuredDefault && accounts && isRecord(accounts[configuredDefault])) {
    return configuredDefault;
  }
  if (accounts && isRecord(accounts[DEFAULT_ACCOUNT_ID])) {
    return DEFAULT_ACCOUNT_ID;
  }
  return DEFAULT_ACCOUNT_ID;
}

function resolveMatrixMigrationPlan(params: {
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
}): MatrixLegacyStatePlan | { warning: string } | null {
  const legacy = resolveLegacyMatrixPaths(params.env);
  if (!fs.existsSync(legacy.storagePath) && !fs.existsSync(legacy.cryptoPath)) {
    return null;
  }

  const channel = resolveMatrixChannelConfig(params.cfg);
  if (!channel) {
    return {
      warning:
        `Legacy Matrix state detected at ${legacy.rootDir}, but channels.matrix is not configured yet. ` +
        'Configure Matrix, then rerun "openclaw doctor --fix" or restart the gateway.',
    };
  }

  const accountId = resolveMatrixTargetAccountId(params.cfg);
  const account = resolveMatrixAccountConfig(params.cfg, accountId);
  const stored = loadStoredMatrixCredentials(params.env, accountId);

  const homeserver = typeof account.homeserver === "string" ? account.homeserver.trim() : "";
  const configUserId = typeof account.userId === "string" ? account.userId.trim() : "";
  const configAccessToken =
    typeof account.accessToken === "string" ? account.accessToken.trim() : "";

  const storedMatchesHomeserver =
    stored && homeserver ? stored.homeserver === homeserver : Boolean(stored);
  const storedMatchesUser =
    stored && configUserId ? stored.userId === configUserId : Boolean(stored);

  const userId =
    configUserId || (storedMatchesHomeserver && storedMatchesUser ? (stored?.userId ?? "") : "");
  const accessToken =
    configAccessToken ||
    (storedMatchesHomeserver && storedMatchesUser ? (stored?.accessToken ?? "") : "");

  if (!homeserver || !userId || !accessToken) {
    return {
      warning:
        `Legacy Matrix state detected at ${legacy.rootDir}, but the new account-scoped target could not be resolved yet ` +
        `(need homeserver, userId, and access token for channels.matrix${accountId === DEFAULT_ACCOUNT_ID ? "" : `.accounts.${accountId}`}). ` +
        'Start the gateway once with a working Matrix login, or rerun "openclaw doctor --fix" after cached credentials are available.',
    };
  }

  const stateDir = resolveStateDir(params.env, os.homedir);
  const { rootDir } = resolveMatrixAccountStorageRoot({
    stateDir,
    homeserver,
    userId,
    accessToken,
    accountId,
  });

  return {
    accountId,
    legacyStoragePath: legacy.storagePath,
    legacyCryptoPath: legacy.cryptoPath,
    targetRootDir: rootDir,
    targetStoragePath: path.join(rootDir, "bot-storage.json"),
    targetCryptoPath: path.join(rootDir, "crypto"),
  };
}

export function detectLegacyMatrixState(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): MatrixLegacyStatePlan | { warning: string } | null {
  return resolveMatrixMigrationPlan({
    cfg: params.cfg,
    env: params.env ?? process.env,
  });
}

function moveLegacyPath(params: {
  sourcePath: string;
  targetPath: string;
  label: string;
  changes: string[];
  warnings: string[];
}): void {
  if (!fs.existsSync(params.sourcePath)) {
    return;
  }
  if (fs.existsSync(params.targetPath)) {
    params.warnings.push(
      `Matrix legacy ${params.label} not migrated because the target already exists (${params.targetPath}).`,
    );
    return;
  }
  try {
    fs.mkdirSync(path.dirname(params.targetPath), { recursive: true });
    fs.renameSync(params.sourcePath, params.targetPath);
    params.changes.push(
      `Migrated Matrix legacy ${params.label}: ${params.sourcePath} -> ${params.targetPath}`,
    );
  } catch (err) {
    params.warnings.push(
      `Failed migrating Matrix legacy ${params.label} (${params.sourcePath} -> ${params.targetPath}): ${String(err)}`,
    );
  }
}

export async function autoMigrateLegacyMatrixState(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  log?: { info?: (message: string) => void; warn?: (message: string) => void };
}): Promise<MatrixLegacyStateMigrationResult> {
  const env = params.env ?? process.env;
  const detection = detectLegacyMatrixState({ cfg: params.cfg, env });
  if (!detection) {
    return { migrated: false, changes: [], warnings: [] };
  }
  if ("warning" in detection) {
    params.log?.warn?.(`matrix: ${detection.warning}`);
    return { migrated: false, changes: [], warnings: [detection.warning] };
  }

  const changes: string[] = [];
  const warnings: string[] = [];
  moveLegacyPath({
    sourcePath: detection.legacyStoragePath,
    targetPath: detection.targetStoragePath,
    label: "sync store",
    changes,
    warnings,
  });
  moveLegacyPath({
    sourcePath: detection.legacyCryptoPath,
    targetPath: detection.targetCryptoPath,
    label: "crypto store",
    changes,
    warnings,
  });

  if (changes.length > 0) {
    params.log?.info?.(
      `matrix: plugin upgraded in place for account "${detection.accountId}".\n${changes
        .map((entry) => `- ${entry}`)
        .join("\n")}\n- No user action required.`,
    );
  }
  if (warnings.length > 0) {
    params.log?.warn?.(
      `matrix: legacy state migration warnings:\n${warnings.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  return {
    migrated: changes.length > 0,
    changes,
    warnings,
  };
}
