import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveMatrixAccountStorageRoot,
  resolveMatrixLegacyFlatStoragePaths,
} from "openclaw/plugin-sdk/matrix";
import { getMatrixRuntime } from "../../runtime.js";
import type { MatrixStoragePaths } from "./types.js";

export const DEFAULT_ACCOUNT_KEY = "default";
const STORAGE_META_FILENAME = "storage-meta.json";

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

export function maybeMigrateLegacyStorage(params: {
  storagePaths: MatrixStoragePaths;
  env?: NodeJS.ProcessEnv;
}): void {
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

  fs.mkdirSync(params.storagePaths.rootDir, { recursive: true });
  if (hasLegacyStorage) {
    try {
      fs.renameSync(legacy.storagePath, params.storagePaths.storagePath);
    } catch {
      // Ignore migration failures; new store will be created.
    }
  }
  if (hasLegacyCrypto) {
    try {
      fs.renameSync(legacy.cryptoPath, params.storagePaths.cryptoPath);
    } catch {
      // Ignore migration failures; new store will be created.
    }
  }
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
