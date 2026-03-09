import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import {
  resolveMatrixChannelConfig,
  resolveMatrixDefaultOrOnlyAccountId,
} from "./matrix-account-selection.js";
import {
  credentialsMatchResolvedIdentity,
  loadStoredMatrixCredentials,
  resolveMatrixMigrationConfigFields,
} from "./matrix-migration-config.js";
import {
  resolveMatrixAccountStorageRoot,
  resolveMatrixLegacyFlatStoragePaths,
} from "./matrix-storage-paths.js";

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
  selectionNote?: string;
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

function resolveMatrixTargetAccountId(cfg: OpenClawConfig): string {
  return resolveMatrixDefaultOrOnlyAccountId(cfg);
}

function resolveMatrixFlatStoreSelectionNote(params: {
  channel: Record<string, unknown>;
  accountId: string;
}): string | undefined {
  const accounts = isRecord(params.channel.accounts) ? params.channel.accounts : null;
  if (!accounts) {
    return undefined;
  }

  const configuredAccounts = Array.from(
    new Set(
      Object.keys(accounts)
        .map((accountId) => normalizeAccountId(accountId))
        .filter(Boolean),
    ),
  );
  if (configuredAccounts.length <= 1) {
    return undefined;
  }

  return (
    `Legacy Matrix flat store uses one shared on-disk state, so it will be migrated into ` +
    `account "${params.accountId}".`
  );
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
  const stored = loadStoredMatrixCredentials(params.env, accountId);
  const selectionNote = resolveMatrixFlatStoreSelectionNote({ channel, accountId });
  const resolved = resolveMatrixMigrationConfigFields({
    cfg: params.cfg,
    env: params.env,
    accountId,
  });
  const matchingStored = credentialsMatchResolvedIdentity(stored, {
    homeserver: resolved.homeserver,
    userId: resolved.userId,
  })
    ? stored
    : null;
  const homeserver = resolved.homeserver;
  const userId = resolved.userId || matchingStored?.userId || "";
  const accessToken = resolved.accessToken || matchingStored?.accessToken || "";

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
    selectionNote,
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
    const details = [
      ...changes.map((entry) => `- ${entry}`),
      ...(detection.selectionNote ? [`- ${detection.selectionNote}`] : []),
      "- No user action required.",
    ];
    params.log?.info?.(
      `matrix: plugin upgraded in place for account "${detection.accountId}".\n${details.join("\n")}`,
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
