import os from "node:os";
import path from "node:path";
import {
  readJsonFileWithFallback,
  resolveMatrixAccountStorageRoot,
  writeJsonFileAtomically,
} from "openclaw/plugin-sdk/matrix";
import { getMatrixRuntime } from "../../runtime.js";
import type { MatrixAuth } from "../client/types.js";
import type { MatrixClient } from "../sdk.js";

type MatrixLegacyCryptoMigrationState = {
  version: 1;
  accountId: string;
  roomKeyCounts: {
    total: number;
    backedUp: number;
  } | null;
  restoreStatus: "pending" | "completed" | "manual-action-required";
  restoredAt?: string;
  importedCount?: number;
  totalCount?: number;
  lastError?: string | null;
};

export type MatrixLegacyCryptoRestoreResult =
  | { kind: "skipped" }
  | {
      kind: "restored";
      imported: number;
      total: number;
      localOnlyKeys: number;
    }
  | {
      kind: "failed";
      error: string;
      localOnlyKeys: number;
    };

function isMigrationState(value: unknown): value is MatrixLegacyCryptoMigrationState {
  return (
    Boolean(value) && typeof value === "object" && (value as { version?: unknown }).version === 1
  );
}

export async function maybeRestoreLegacyMatrixBackup(params: {
  client: Pick<MatrixClient, "restoreRoomKeyBackup">;
  auth: Pick<MatrixAuth, "homeserver" | "userId" | "accessToken">;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
}): Promise<MatrixLegacyCryptoRestoreResult> {
  const env = params.env ?? process.env;
  const stateDir = params.stateDir ?? getMatrixRuntime().state.resolveStateDir(env, os.homedir);
  const { rootDir } = resolveMatrixAccountStorageRoot({
    stateDir,
    homeserver: params.auth.homeserver,
    userId: params.auth.userId,
    accessToken: params.auth.accessToken,
    accountId: params.accountId,
  });
  const statePath = path.join(rootDir, "legacy-crypto-migration.json");
  const { value } = await readJsonFileWithFallback<MatrixLegacyCryptoMigrationState | null>(
    statePath,
    null,
  );
  if (!isMigrationState(value) || value.restoreStatus !== "pending") {
    return { kind: "skipped" };
  }

  const restore = await params.client.restoreRoomKeyBackup();
  const localOnlyKeys =
    value.roomKeyCounts && value.roomKeyCounts.total > value.roomKeyCounts.backedUp
      ? value.roomKeyCounts.total - value.roomKeyCounts.backedUp
      : 0;

  if (restore.success) {
    await writeJsonFileAtomically(statePath, {
      ...value,
      restoreStatus: "completed",
      restoredAt: restore.restoredAt ?? new Date().toISOString(),
      importedCount: restore.imported,
      totalCount: restore.total,
      lastError: null,
    } satisfies MatrixLegacyCryptoMigrationState);
    return {
      kind: "restored",
      imported: restore.imported,
      total: restore.total,
      localOnlyKeys,
    };
  }

  await writeJsonFileAtomically(statePath, {
    ...value,
    lastError: restore.error ?? "unknown",
  } satisfies MatrixLegacyCryptoMigrationState);
  return {
    kind: "failed",
    error: restore.error ?? "unknown",
    localOnlyKeys,
  };
}
