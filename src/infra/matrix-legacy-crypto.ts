import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { writeJsonFileAtomically } from "../plugin-sdk/json-store.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "../routing/session-key.js";
import {
  resolveMatrixAccountStorageRoot,
  resolveMatrixCredentialsPath,
  resolveMatrixLegacyFlatStoragePaths,
} from "./matrix-storage-paths.js";

type MatrixStoredCredentials = {
  homeserver: string;
  userId: string;
  accessToken: string;
  deviceId?: string;
};

type MatrixLegacyCryptoCounts = {
  total: number;
  backedUp: number;
};

type MatrixLegacyCryptoSummary = {
  deviceId: string | null;
  roomKeyCounts: MatrixLegacyCryptoCounts | null;
  backupVersion: string | null;
  decryptionKeyBase64: string | null;
};

export type MatrixLegacyCryptoMigrationState = {
  version: 1;
  source: "matrix-bot-sdk-rust";
  accountId: string;
  deviceId: string | null;
  roomKeyCounts: MatrixLegacyCryptoCounts | null;
  backupVersion: string | null;
  decryptionKeyImported: boolean;
  restoreStatus: "pending" | "completed" | "manual-action-required";
  detectedAt: string;
  restoredAt?: string;
  importedCount?: number;
  totalCount?: number;
  lastError?: string | null;
};

type MatrixLegacyCryptoPlan = {
  accountId: string;
  rootDir: string;
  recoveryKeyPath: string;
  statePath: string;
  legacyCryptoPath: string;
  homeserver: string;
  userId: string;
  accessToken: string;
  deviceId: string | null;
};

type MatrixLegacyCryptoDetection = {
  plans: MatrixLegacyCryptoPlan[];
  warnings: string[];
};

export type MatrixLegacyCryptoPreparationResult = {
  migrated: boolean;
  changes: string[];
  warnings: string[];
};

export type MatrixLegacyCryptoPrepareDeps = {
  inspectLegacyStore: (params: {
    cryptoRootDir: string;
    userId: string;
    deviceId: string;
  }) => Promise<MatrixLegacyCryptoSummary>;
};

type MatrixLegacyBotSdkMetadata = {
  deviceId: string | null;
};

type MatrixStoredRecoveryKey = {
  version: 1;
  createdAt: string;
  keyId?: string | null;
  encodedPrivateKey?: string;
  privateKeyBase64: string;
  keyInfo?: {
    passphrase?: unknown;
    name?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLegacyBotSdkCryptoStore(cryptoRootDir: string): boolean {
  return (
    fs.existsSync(path.join(cryptoRootDir, "bot-sdk.json")) ||
    fs.existsSync(path.join(cryptoRootDir, "matrix-sdk-crypto.sqlite3")) ||
    fs
      .readdirSync(cryptoRootDir, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(cryptoRootDir, entry.name, "matrix-sdk-crypto.sqlite3")),
      )
  );
}

function loadStoredMatrixCredentials(
  env: NodeJS.ProcessEnv,
  accountId: string,
): MatrixStoredCredentials | null {
  const stateDir = resolveStateDir(env, os.homedir);
  const credentialsPath = resolveMatrixCredentialsPath({
    stateDir,
    accountId: normalizeAccountId(accountId),
  });
  try {
    if (!fs.existsSync(credentialsPath)) {
      return null;
    }
    const parsed = JSON.parse(
      fs.readFileSync(credentialsPath, "utf8"),
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
      deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : undefined,
    };
  } catch {
    return null;
  }
}

function resolveMatrixChannelConfig(cfg: OpenClawConfig): Record<string, unknown> | null {
  return isRecord(cfg.channels?.matrix) ? cfg.channels.matrix : null;
}

function resolveMatrixAccountIds(cfg: OpenClawConfig): string[] {
  const channel = resolveMatrixChannelConfig(cfg);
  if (!channel) {
    return [];
  }
  const accounts = isRecord(channel.accounts) ? channel.accounts : null;
  if (!accounts) {
    return [DEFAULT_ACCOUNT_ID];
  }
  const ids = Object.keys(accounts).map((accountId) => normalizeAccountId(accountId));
  return Array.from(new Set(ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID])).toSorted((a, b) =>
    a.localeCompare(b),
  );
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

function resolveLegacyMatrixFlatStorePlan(params: {
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
}): MatrixLegacyCryptoPlan | { warning: string } | null {
  const legacy = resolveMatrixLegacyFlatStoragePaths(resolveStateDir(params.env, os.homedir));
  if (!fs.existsSync(legacy.cryptoPath) || !isLegacyBotSdkCryptoStore(legacy.cryptoPath)) {
    return null;
  }

  const channel = resolveMatrixChannelConfig(params.cfg);
  if (!channel) {
    return {
      warning:
        `Legacy Matrix encrypted state detected at ${legacy.cryptoPath}, but channels.matrix is not configured yet. ` +
        'Configure Matrix, then rerun "openclaw doctor --fix" or restart the gateway.',
    };
  }

  const accounts = isRecord(channel.accounts) ? channel.accounts : null;
  const configuredDefault = normalizeOptionalAccountId(
    typeof channel.defaultAccount === "string" ? channel.defaultAccount : undefined,
  );
  const accountId =
    configuredDefault && accounts && isRecord(accounts[configuredDefault])
      ? configuredDefault
      : DEFAULT_ACCOUNT_ID;
  const stored = loadStoredMatrixCredentials(params.env, accountId);
  const account = resolveMatrixAccountConfig(params.cfg, accountId);
  const homeserver = typeof account.homeserver === "string" ? account.homeserver.trim() : "";
  const userId =
    (typeof account.userId === "string" ? account.userId.trim() : "") || stored?.userId || "";
  const accessToken =
    (typeof account.accessToken === "string" ? account.accessToken.trim() : "") ||
    stored?.accessToken ||
    "";

  if (!homeserver || !userId || !accessToken) {
    return {
      warning:
        `Legacy Matrix encrypted state detected at ${legacy.cryptoPath}, but the account-scoped target could not be resolved yet ` +
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
  const metadata = loadLegacyBotSdkMetadata(legacy.cryptoPath);
  return {
    accountId,
    rootDir,
    recoveryKeyPath: path.join(rootDir, "recovery-key.json"),
    statePath: path.join(rootDir, "legacy-crypto-migration.json"),
    legacyCryptoPath: legacy.cryptoPath,
    homeserver,
    userId,
    accessToken,
    deviceId: metadata.deviceId ?? stored?.deviceId ?? null,
  };
}

function loadLegacyBotSdkMetadata(cryptoRootDir: string): MatrixLegacyBotSdkMetadata {
  const metadataPath = path.join(cryptoRootDir, "bot-sdk.json");
  const fallback: MatrixLegacyBotSdkMetadata = { deviceId: null };
  try {
    if (!fs.existsSync(metadataPath)) {
      return fallback;
    }
    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      deviceId?: unknown;
    };
    return {
      deviceId:
        typeof parsed.deviceId === "string" && parsed.deviceId.trim() ? parsed.deviceId : null,
    };
  } catch {
    return fallback;
  }
}

function resolveMatrixLegacyCryptoPlans(params: {
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
}): MatrixLegacyCryptoDetection {
  const warnings: string[] = [];
  const plans: MatrixLegacyCryptoPlan[] = [];

  const flatPlan = resolveLegacyMatrixFlatStorePlan(params);
  if (flatPlan) {
    if ("warning" in flatPlan) {
      warnings.push(flatPlan.warning);
    } else {
      plans.push(flatPlan);
    }
  }

  const stateDir = resolveStateDir(params.env, os.homedir);
  for (const accountId of resolveMatrixAccountIds(params.cfg)) {
    const account = resolveMatrixAccountConfig(params.cfg, accountId);
    const stored = loadStoredMatrixCredentials(params.env, accountId);
    const homeserver =
      (typeof account.homeserver === "string" ? account.homeserver.trim() : "") ||
      stored?.homeserver ||
      "";
    const userId =
      (typeof account.userId === "string" ? account.userId.trim() : "") || stored?.userId || "";
    const accessToken =
      (typeof account.accessToken === "string" ? account.accessToken.trim() : "") ||
      stored?.accessToken ||
      "";
    if (!homeserver || !userId || !accessToken) {
      continue;
    }
    const { rootDir } = resolveMatrixAccountStorageRoot({
      stateDir,
      homeserver,
      userId,
      accessToken,
      accountId,
    });
    const legacyCryptoPath = path.join(rootDir, "crypto");
    if (!fs.existsSync(legacyCryptoPath) || !isLegacyBotSdkCryptoStore(legacyCryptoPath)) {
      continue;
    }
    if (
      plans.some(
        (plan) =>
          plan.accountId === accountId &&
          path.resolve(plan.legacyCryptoPath) === path.resolve(legacyCryptoPath),
      )
    ) {
      continue;
    }
    const metadata = loadLegacyBotSdkMetadata(legacyCryptoPath);
    plans.push({
      accountId,
      rootDir,
      recoveryKeyPath: path.join(rootDir, "recovery-key.json"),
      statePath: path.join(rootDir, "legacy-crypto-migration.json"),
      legacyCryptoPath,
      homeserver,
      userId,
      accessToken,
      deviceId: metadata.deviceId ?? stored?.deviceId ?? null,
    });
  }

  return { plans, warnings };
}

function loadStoredRecoveryKey(filePath: string): MatrixStoredRecoveryKey | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MatrixStoredRecoveryKey;
  } catch {
    return null;
  }
}

function loadLegacyCryptoMigrationState(filePath: string): MatrixLegacyCryptoMigrationState | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MatrixLegacyCryptoMigrationState;
  } catch {
    return null;
  }
}

function resolveLegacyMachineStorePath(params: {
  cryptoRootDir: string;
  deviceId: string;
}): string | null {
  const hashedDir = path.join(
    params.cryptoRootDir,
    crypto.createHash("sha256").update(params.deviceId).digest("hex"),
  );
  if (fs.existsSync(path.join(hashedDir, "matrix-sdk-crypto.sqlite3"))) {
    return hashedDir;
  }
  if (fs.existsSync(path.join(params.cryptoRootDir, "matrix-sdk-crypto.sqlite3"))) {
    return params.cryptoRootDir;
  }
  const match = fs
    .readdirSync(params.cryptoRootDir, { withFileTypes: true })
    .find(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(params.cryptoRootDir, entry.name, "matrix-sdk-crypto.sqlite3")),
    );
  return match ? path.join(params.cryptoRootDir, match.name) : null;
}

async function inspectLegacyStoreWithCryptoNodejs(params: {
  cryptoRootDir: string;
  userId: string;
  deviceId: string;
}): Promise<MatrixLegacyCryptoSummary> {
  const machineStorePath = resolveLegacyMachineStorePath(params);
  if (!machineStorePath) {
    throw new Error(`Matrix legacy crypto store not found for device ${params.deviceId}`);
  }
  const { DeviceId, OlmMachine, StoreType, UserId } =
    await import("@matrix-org/matrix-sdk-crypto-nodejs");
  const machine = await OlmMachine.initialize(
    new UserId(params.userId),
    new DeviceId(params.deviceId),
    machineStorePath,
    "",
    StoreType.Sqlite,
  );
  try {
    const [backupKeys, roomKeyCounts] = await Promise.all([
      machine.getBackupKeys(),
      machine.roomKeyCounts(),
    ]);
    return {
      deviceId: params.deviceId,
      roomKeyCounts: roomKeyCounts
        ? {
            total: typeof roomKeyCounts.total === "number" ? roomKeyCounts.total : 0,
            backedUp: typeof roomKeyCounts.backedUp === "number" ? roomKeyCounts.backedUp : 0,
          }
        : null,
      backupVersion:
        typeof backupKeys?.backupVersion === "string" && backupKeys.backupVersion.trim()
          ? backupKeys.backupVersion
          : null,
      decryptionKeyBase64:
        typeof backupKeys?.decryptionKeyBase64 === "string" && backupKeys.decryptionKeyBase64.trim()
          ? backupKeys.decryptionKeyBase64
          : null,
    };
  } finally {
    machine.close();
  }
}

async function persistLegacyMigrationState(params: {
  filePath: string;
  state: MatrixLegacyCryptoMigrationState;
}): Promise<void> {
  await writeJsonFileAtomically(params.filePath, params.state);
}

export function detectLegacyMatrixCrypto(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): MatrixLegacyCryptoDetection {
  return resolveMatrixLegacyCryptoPlans({
    cfg: params.cfg,
    env: params.env ?? process.env,
  });
}

export async function autoPrepareLegacyMatrixCrypto(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  log?: { info?: (message: string) => void; warn?: (message: string) => void };
  deps?: Partial<MatrixLegacyCryptoPrepareDeps>;
}): Promise<MatrixLegacyCryptoPreparationResult> {
  const env = params.env ?? process.env;
  const detection = resolveMatrixLegacyCryptoPlans({ cfg: params.cfg, env });
  const warnings = [...detection.warnings];
  const changes: string[] = [];
  const inspectLegacyStore = params.deps?.inspectLegacyStore ?? inspectLegacyStoreWithCryptoNodejs;

  for (const plan of detection.plans) {
    const existingState = loadLegacyCryptoMigrationState(plan.statePath);
    if (existingState?.version === 1) {
      continue;
    }
    if (!plan.deviceId) {
      warnings.push(
        `Legacy Matrix encrypted state detected at ${plan.legacyCryptoPath}, but no device ID was found for account "${plan.accountId}". ` +
          `OpenClaw will continue, but old encrypted history cannot be recovered automatically.`,
      );
      continue;
    }

    let summary: MatrixLegacyCryptoSummary;
    try {
      summary = await inspectLegacyStore({
        cryptoRootDir: plan.legacyCryptoPath,
        userId: plan.userId,
        deviceId: plan.deviceId,
      });
    } catch (err) {
      warnings.push(
        `Failed inspecting legacy Matrix encrypted state for account "${plan.accountId}" (${plan.legacyCryptoPath}): ${String(err)}`,
      );
      continue;
    }

    let decryptionKeyImported = false;
    if (summary.decryptionKeyBase64) {
      const existingRecoveryKey = loadStoredRecoveryKey(plan.recoveryKeyPath);
      if (
        existingRecoveryKey?.privateKeyBase64 &&
        existingRecoveryKey.privateKeyBase64 !== summary.decryptionKeyBase64
      ) {
        warnings.push(
          `Legacy Matrix backup key was found for account "${plan.accountId}", but ${plan.recoveryKeyPath} already contains a different recovery key. Leaving the existing file unchanged.`,
        );
      } else if (!existingRecoveryKey?.privateKeyBase64) {
        const payload: MatrixStoredRecoveryKey = {
          version: 1,
          createdAt: new Date().toISOString(),
          keyId: null,
          privateKeyBase64: summary.decryptionKeyBase64,
        };
        await writeJsonFileAtomically(plan.recoveryKeyPath, payload);
        changes.push(
          `Imported Matrix legacy backup key for account "${plan.accountId}": ${plan.recoveryKeyPath}`,
        );
        decryptionKeyImported = true;
      } else {
        decryptionKeyImported = true;
      }
    }

    const localOnlyKeys =
      summary.roomKeyCounts && summary.roomKeyCounts.total > summary.roomKeyCounts.backedUp
        ? summary.roomKeyCounts.total - summary.roomKeyCounts.backedUp
        : 0;
    if (localOnlyKeys > 0) {
      warnings.push(
        `Legacy Matrix encrypted state for account "${plan.accountId}" contains ${localOnlyKeys} room key(s) that were never backed up. ` +
          "Backed-up keys can be restored automatically, but local-only encrypted history may remain unavailable after upgrade.",
      );
    }
    if (!summary.decryptionKeyBase64 && (summary.roomKeyCounts?.backedUp ?? 0) > 0) {
      warnings.push(
        `Legacy Matrix encrypted state for account "${plan.accountId}" has backed-up room keys, but no local backup decryption key was found. ` +
          `Ask the operator to run "openclaw matrix verify backup restore --recovery-key <key>" after upgrade if they have the recovery key.`,
      );
    }
    if (!summary.decryptionKeyBase64 && (summary.roomKeyCounts?.total ?? 0) > 0) {
      warnings.push(
        `Legacy Matrix encrypted state for account "${plan.accountId}" cannot be fully converted automatically because the old rust crypto store does not expose all local room keys for export.`,
      );
    }

    const state: MatrixLegacyCryptoMigrationState = {
      version: 1,
      source: "matrix-bot-sdk-rust",
      accountId: plan.accountId,
      deviceId: summary.deviceId,
      roomKeyCounts: summary.roomKeyCounts,
      backupVersion: summary.backupVersion,
      decryptionKeyImported,
      restoreStatus: decryptionKeyImported ? "pending" : "manual-action-required",
      detectedAt: new Date().toISOString(),
      lastError: null,
    };
    await persistLegacyMigrationState({ filePath: plan.statePath, state });
    changes.push(
      `Prepared Matrix legacy encrypted-state migration for account "${plan.accountId}": ${plan.statePath}`,
    );
  }

  if (changes.length > 0) {
    params.log?.info?.(
      `matrix: prepared encrypted-state upgrade.\n${changes.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }
  if (warnings.length > 0) {
    params.log?.warn?.(
      `matrix: legacy encrypted-state warnings:\n${warnings.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  return {
    migrated: changes.length > 0,
    changes,
    warnings,
  };
}
