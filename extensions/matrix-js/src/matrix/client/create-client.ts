import fs from "node:fs";
import { MatrixClient } from "../sdk.js";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";
import {
  maybeMigrateLegacyStorage,
  resolveMatrixStoragePaths,
  writeStorageMeta,
} from "./storage.js";

export async function createMatrixClient(params: {
  homeserver: string;
  userId?: string;
  accessToken: string;
  password?: string;
  deviceId?: string;
  encryption?: boolean;
  localTimeoutMs?: number;
  initialSyncLimit?: number;
  accountId?: string | null;
  autoBootstrapCrypto?: boolean;
}): Promise<MatrixClient> {
  ensureMatrixSdkLoggingConfigured();
  const env = process.env;
  const userId = params.userId?.trim() || "unknown";
  const matrixClientUserId = params.userId?.trim() || undefined;

  const storagePaths = resolveMatrixStoragePaths({
    homeserver: params.homeserver,
    userId,
    accessToken: params.accessToken,
    accountId: params.accountId,
    env,
  });
  maybeMigrateLegacyStorage({ storagePaths, env });
  fs.mkdirSync(storagePaths.rootDir, { recursive: true });

  writeStorageMeta({
    storagePaths,
    homeserver: params.homeserver,
    userId,
    accountId: params.accountId,
  });

  const cryptoDatabasePrefix = `openclaw-matrix-js-${storagePaths.accountKey}-${storagePaths.tokenHash}`;

  return new MatrixClient(params.homeserver, params.accessToken, undefined, undefined, {
    userId: matrixClientUserId,
    password: params.password,
    deviceId: params.deviceId,
    encryption: params.encryption,
    localTimeoutMs: params.localTimeoutMs,
    initialSyncLimit: params.initialSyncLimit,
    recoveryKeyPath: storagePaths.recoveryKeyPath,
    idbSnapshotPath: storagePaths.idbSnapshotPath,
    cryptoDatabasePrefix,
    autoBootstrapCrypto: params.autoBootstrapCrypto,
  });
}
