import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  maybeCreateMatrixMigrationSnapshot,
  resolveMatrixAccountStorageRoot,
  resolveMatrixLegacyFlatStoragePaths,
} from "openclaw/plugin-sdk/matrix";
import { getMatrixRuntime } from "../../runtime.js";
import type { MatrixStoragePaths } from "./types.js";

export const DEFAULT_ACCOUNT_KEY = "default";
const STORAGE_META_FILENAME = "storage-meta.json";

type LegacyMoveRecord = {
  sourcePath: string;
  targetPath: string;
  label: string;
};

function resolveLegacyStoragePaths(env: NodeJS.ProcessEnv = process.env): {
  storagePath: string;
  cryptoPath: string;
} {
  const stateDir = getMatrixRuntime().state.resolveStateDir(env, os.homedir);
  const legacy = resolveMatrixLegacyFlatStoragePaths(stateDir);
  return { storagePath: legacy.storagePath, cryptoPath: legacy.cryptoPath };
}

export function resolveMatrixStoragePaths(params: {
  homeserver: string;
  userId: string;
  accessToken: string;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
}): MatrixStoragePaths {
  const env = params.env ?? process.env;
  const stateDir = getMatrixRuntime().state.resolveStateDir(env, os.homedir);
  const { rootDir, accountKey, tokenHash } = resolveMatrixAccountStorageRoot({
    stateDir,
    homeserver: params.homeserver,
    userId: params.userId,
    accessToken: params.accessToken,
    accountId: params.accountId,
  });
  return {
    rootDir,
    storagePath: path.join(rootDir, "bot-storage.json"),
    cryptoPath: path.join(rootDir, "crypto"),
    metaPath: path.join(rootDir, STORAGE_META_FILENAME),
    recoveryKeyPath: path.join(rootDir, "recovery-key.json"),
    idbSnapshotPath: path.join(rootDir, "crypto-idb-snapshot.json"),
    accountKey,
    tokenHash,
  };
}

export async function maybeMigrateLegacyStorage(params: {
  storagePaths: MatrixStoragePaths;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const hasNewStorage =
    fs.existsSync(params.storagePaths.storagePath) || fs.existsSync(params.storagePaths.cryptoPath);
  if (hasNewStorage) {
    return;
  }

  const legacy = resolveLegacyStoragePaths(params.env);
  const hasLegacyStorage = fs.existsSync(legacy.storagePath);
  const hasLegacyCrypto = fs.existsSync(legacy.cryptoPath);
  if (!hasLegacyStorage && !hasLegacyCrypto) {
    return;
  }

  const logger = getMatrixRuntime().logging.getChildLogger({ module: "matrix-storage" });
  await maybeCreateMatrixMigrationSnapshot({
    trigger: "matrix-client-fallback",
    env: params.env,
    log: logger,
  });
  fs.mkdirSync(params.storagePaths.rootDir, { recursive: true });
  const moved: LegacyMoveRecord[] = [];
  try {
    if (hasLegacyStorage) {
      moveLegacyStoragePathOrThrow({
        sourcePath: legacy.storagePath,
        targetPath: params.storagePaths.storagePath,
        label: "sync store",
        moved,
      });
    }
    if (hasLegacyCrypto) {
      moveLegacyStoragePathOrThrow({
        sourcePath: legacy.cryptoPath,
        targetPath: params.storagePaths.cryptoPath,
        label: "crypto store",
        moved,
      });
    }
  } catch (err) {
    const rollbackError = rollbackLegacyMoves(moved);
    throw new Error(
      rollbackError
        ? `Failed migrating legacy Matrix client storage: ${String(err)}. Rollback also failed: ${rollbackError}`
        : `Failed migrating legacy Matrix client storage: ${String(err)}`,
    );
  }
  if (moved.length > 0) {
    logger.info(
      `matrix: migrated legacy client storage into ${params.storagePaths.rootDir}\n${moved
        .map((entry) => `- ${entry.label}: ${entry.sourcePath} -> ${entry.targetPath}`)
        .join("\n")}`,
    );
  }
}

function moveLegacyStoragePathOrThrow(params: {
  sourcePath: string;
  targetPath: string;
  label: string;
  moved: LegacyMoveRecord[];
}): void {
  if (!fs.existsSync(params.sourcePath)) {
    return;
  }
  if (fs.existsSync(params.targetPath)) {
    throw new Error(
      `legacy Matrix ${params.label} target already exists (${params.targetPath}); refusing to overwrite it automatically`,
    );
  }
  fs.renameSync(params.sourcePath, params.targetPath);
  params.moved.push({
    sourcePath: params.sourcePath,
    targetPath: params.targetPath,
    label: params.label,
  });
}

function rollbackLegacyMoves(moved: LegacyMoveRecord[]): string | null {
  for (const entry of moved.toReversed()) {
    try {
      if (!fs.existsSync(entry.targetPath) || fs.existsSync(entry.sourcePath)) {
        continue;
      }
      fs.renameSync(entry.targetPath, entry.sourcePath);
    } catch (err) {
      return `${entry.label} (${entry.targetPath} -> ${entry.sourcePath}): ${String(err)}`;
    }
  }
  return null;
}

export function writeStorageMeta(params: {
  storagePaths: MatrixStoragePaths;
  homeserver: string;
  userId: string;
  accountId?: string | null;
}): void {
  try {
    const payload = {
      homeserver: params.homeserver,
      userId: params.userId,
      accountId: params.accountId ?? DEFAULT_ACCOUNT_KEY,
      accessTokenHash: params.storagePaths.tokenHash,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(params.storagePaths.rootDir, { recursive: true });
    fs.writeFileSync(params.storagePaths.metaPath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // ignore meta write failures
  }
}
