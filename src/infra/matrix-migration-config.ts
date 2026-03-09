import fs from "node:fs";
import os from "node:os";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { normalizeAccountId } from "../routing/session-key.js";
import { findMatrixAccountEntry, resolveMatrixChannelConfig } from "./matrix-account-selection.js";
import { resolveMatrixCredentialsPath } from "./matrix-storage-paths.js";

export type MatrixStoredCredentials = {
  homeserver: string;
  userId: string;
  accessToken: string;
  deviceId?: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveMatrixEnvAccountToken(accountId: string): string {
  return normalizeAccountId(accountId)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function resolveScopedMatrixEnvConfig(
  accountId: string,
  env: NodeJS.ProcessEnv,
): {
  homeserver: string;
  userId: string;
  accessToken: string;
} {
  const token = resolveMatrixEnvAccountToken(accountId);
  return {
    homeserver: clean(env[`MATRIX_${token}_HOMESERVER`]),
    userId: clean(env[`MATRIX_${token}_USER_ID`]),
    accessToken: clean(env[`MATRIX_${token}_ACCESS_TOKEN`]),
  };
}

function resolveGlobalMatrixEnvConfig(env: NodeJS.ProcessEnv): {
  homeserver: string;
  userId: string;
  accessToken: string;
} {
  return {
    homeserver: clean(env.MATRIX_HOMESERVER),
    userId: clean(env.MATRIX_USER_ID),
    accessToken: clean(env.MATRIX_ACCESS_TOKEN),
  };
}

function resolveMatrixAccountConfigEntry(
  cfg: OpenClawConfig,
  accountId: string,
): Record<string, unknown> | null {
  return findMatrixAccountEntry(cfg, accountId);
}

export function resolveMatrixMigrationConfigFields(params: {
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  accountId: string;
}): {
  homeserver: string;
  userId: string;
  accessToken: string;
} {
  const channel = resolveMatrixChannelConfig(params.cfg);
  const account = resolveMatrixAccountConfigEntry(params.cfg, params.accountId);
  const scopedEnv = resolveScopedMatrixEnvConfig(params.accountId, params.env);
  const globalEnv = resolveGlobalMatrixEnvConfig(params.env);

  return {
    homeserver:
      clean(account?.homeserver) ||
      scopedEnv.homeserver ||
      clean(channel?.homeserver) ||
      globalEnv.homeserver,
    userId:
      clean(account?.userId) || scopedEnv.userId || clean(channel?.userId) || globalEnv.userId,
    accessToken:
      clean(account?.accessToken) ||
      scopedEnv.accessToken ||
      clean(channel?.accessToken) ||
      globalEnv.accessToken,
  };
}

export function loadStoredMatrixCredentials(
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

export function credentialsMatchResolvedIdentity(
  stored: MatrixStoredCredentials | null,
  identity: {
    homeserver: string;
    userId: string;
  },
): stored is MatrixStoredCredentials {
  if (!stored || !identity.homeserver) {
    return false;
  }
  if (!identity.userId) {
    return stored.homeserver === identity.homeserver;
  }
  return stored.homeserver === identity.homeserver && stored.userId === identity.userId;
}
