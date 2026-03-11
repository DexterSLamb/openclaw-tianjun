import type { OpenClawConfig } from "../config/config.js";
import { autoPrepareLegacyMatrixCrypto } from "../infra/matrix-legacy-crypto.js";
import { autoMigrateLegacyMatrixState } from "../infra/matrix-legacy-state.js";
import {
  hasActionableMatrixMigration,
  hasPendingMatrixMigration,
  maybeCreateMatrixMigrationSnapshot,
} from "../infra/matrix-migration-snapshot.js";

type MatrixMigrationLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export async function runStartupMatrixMigration(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  log: MatrixMigrationLogger;
  deps?: {
    maybeCreateMatrixMigrationSnapshot?: typeof maybeCreateMatrixMigrationSnapshot;
    autoMigrateLegacyMatrixState?: typeof autoMigrateLegacyMatrixState;
    autoPrepareLegacyMatrixCrypto?: typeof autoPrepareLegacyMatrixCrypto;
  };
}): Promise<void> {
  const env = params.env ?? process.env;
  const createSnapshot =
    params.deps?.maybeCreateMatrixMigrationSnapshot ?? maybeCreateMatrixMigrationSnapshot;
  const migrateLegacyState =
    params.deps?.autoMigrateLegacyMatrixState ?? autoMigrateLegacyMatrixState;
  const prepareLegacyCrypto =
    params.deps?.autoPrepareLegacyMatrixCrypto ?? autoPrepareLegacyMatrixCrypto;
  const actionable = hasActionableMatrixMigration({ cfg: params.cfg, env });
  const pending = actionable || hasPendingMatrixMigration({ cfg: params.cfg, env });

  if (!pending) {
    return;
  }
  if (!actionable) {
    params.log.info?.(
      "matrix: migration remains in a warning-only state; no pre-migration snapshot was needed yet",
    );
    return;
  }

  try {
    await createSnapshot({
      trigger: "gateway-startup",
      env,
      log: params.log,
    });
  } catch (err) {
    params.log.warn?.(
      `gateway: failed creating a Matrix migration snapshot; skipping Matrix migration for now: ${String(err)}`,
    );
    return;
  }

  await migrateLegacyState({
    cfg: params.cfg,
    env,
    log: params.log,
  });
  await prepareLegacyCrypto({
    cfg: params.cfg,
    env,
    log: params.log,
  });
}
