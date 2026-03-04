import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { getMatrixRuntime } from "../../runtime.js";
import type { CoreConfig } from "../../types.js";
import { findMatrixAccountConfig, resolveMatrixBaseConfig } from "../account-config.js";
import { MatrixClient } from "../sdk.js";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";
import type { MatrixAuth, MatrixResolvedConfig } from "./types.js";

function clean(value?: string): string {
  return value?.trim() ?? "";
}

type MatrixEnvConfig = {
  homeserver: string;
  userId: string;
  accessToken?: string;
  password?: string;
  deviceId?: string;
  deviceName?: string;
};

function resolveGlobalMatrixEnvConfig(env: NodeJS.ProcessEnv): MatrixEnvConfig {
  return {
    homeserver: clean(env.MATRIX_HOMESERVER),
    userId: clean(env.MATRIX_USER_ID),
    accessToken: clean(env.MATRIX_ACCESS_TOKEN) || undefined,
    password: clean(env.MATRIX_PASSWORD) || undefined,
    deviceId: clean(env.MATRIX_DEVICE_ID) || undefined,
    deviceName: clean(env.MATRIX_DEVICE_NAME) || undefined,
  };
}

function resolveMatrixEnvAccountToken(accountId: string): string {
  return normalizeAccountId(accountId)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function getMatrixScopedEnvVarNames(accountId: string): {
  homeserver: string;
  userId: string;
  accessToken: string;
  password: string;
  deviceId: string;
  deviceName: string;
} {
  const token = resolveMatrixEnvAccountToken(accountId);
  return {
    homeserver: `MATRIX_${token}_HOMESERVER`,
    userId: `MATRIX_${token}_USER_ID`,
    accessToken: `MATRIX_${token}_ACCESS_TOKEN`,
    password: `MATRIX_${token}_PASSWORD`,
    deviceId: `MATRIX_${token}_DEVICE_ID`,
    deviceName: `MATRIX_${token}_DEVICE_NAME`,
  };
}

export function resolveScopedMatrixEnvConfig(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): MatrixEnvConfig {
  const keys = getMatrixScopedEnvVarNames(accountId);
  return {
    homeserver: clean(env[keys.homeserver]),
    userId: clean(env[keys.userId]),
    accessToken: clean(env[keys.accessToken]) || undefined,
    password: clean(env[keys.password]) || undefined,
    deviceId: clean(env[keys.deviceId]) || undefined,
    deviceName: clean(env[keys.deviceName]) || undefined,
  };
}

export function hasReadyMatrixEnvAuth(config: {
  homeserver?: string;
  userId?: string;
  accessToken?: string;
  password?: string;
}): boolean {
  const homeserver = clean(config.homeserver);
  const userId = clean(config.userId);
  const accessToken = clean(config.accessToken);
  const password = clean(config.password);
  return Boolean(homeserver && (accessToken || (userId && password)));
}

export function resolveMatrixConfig(
  cfg: CoreConfig = getMatrixRuntime().config.loadConfig() as CoreConfig,
  env: NodeJS.ProcessEnv = process.env,
): MatrixResolvedConfig {
  const matrix = resolveMatrixBaseConfig(cfg);
  const defaultScopedEnv = resolveScopedMatrixEnvConfig(DEFAULT_ACCOUNT_ID, env);
  const globalEnv = resolveGlobalMatrixEnvConfig(env);
  const homeserver =
    clean(matrix.homeserver) || defaultScopedEnv.homeserver || globalEnv.homeserver;
  const userId = clean(matrix.userId) || defaultScopedEnv.userId || globalEnv.userId;
  const accessToken =
    clean(matrix.accessToken) || defaultScopedEnv.accessToken || globalEnv.accessToken || undefined;
  const password =
    clean(matrix.password) || defaultScopedEnv.password || globalEnv.password || undefined;
  const deviceId =
    clean(matrix.deviceId) || defaultScopedEnv.deviceId || globalEnv.deviceId || undefined;
  const deviceName =
    clean(matrix.deviceName) || defaultScopedEnv.deviceName || globalEnv.deviceName || undefined;
  const initialSyncLimit =
    typeof matrix.initialSyncLimit === "number"
      ? Math.max(0, Math.floor(matrix.initialSyncLimit))
      : undefined;
  const encryption = matrix.encryption ?? false;
  return {
    homeserver,
    userId,
    accessToken,
    password,
    deviceId,
    deviceName,
    initialSyncLimit,
    encryption,
  };
}

export function resolveMatrixConfigForAccount(
  cfg: CoreConfig,
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): MatrixResolvedConfig {
  const matrix = resolveMatrixBaseConfig(cfg);
  const account = findMatrixAccountConfig(cfg, accountId) ?? {};
  const normalizedAccountId = normalizeAccountId(accountId);
  const scopedEnv = resolveScopedMatrixEnvConfig(normalizedAccountId, env);
  const globalEnv = resolveGlobalMatrixEnvConfig(env);

  const accountHomeserver = clean(
    typeof account.homeserver === "string" ? account.homeserver : undefined,
  );
  const accountUserId = clean(typeof account.userId === "string" ? account.userId : undefined);
  const accountAccessToken = clean(
    typeof account.accessToken === "string" ? account.accessToken : undefined,
  );
  const accountPassword = clean(
    typeof account.password === "string" ? account.password : undefined,
  );
  const accountDeviceId = clean(
    typeof account.deviceId === "string" ? account.deviceId : undefined,
  );
  const accountDeviceName = clean(
    typeof account.deviceName === "string" ? account.deviceName : undefined,
  );

  const homeserver =
    accountHomeserver || scopedEnv.homeserver || clean(matrix.homeserver) || globalEnv.homeserver;
  const userId = accountUserId || scopedEnv.userId || clean(matrix.userId) || globalEnv.userId;
  const accessToken =
    accountAccessToken ||
    scopedEnv.accessToken ||
    clean(matrix.accessToken) ||
    globalEnv.accessToken ||
    undefined;
  const password =
    accountPassword ||
    scopedEnv.password ||
    clean(matrix.password) ||
    globalEnv.password ||
    undefined;
  const deviceId =
    accountDeviceId ||
    scopedEnv.deviceId ||
    clean(matrix.deviceId) ||
    globalEnv.deviceId ||
    undefined;
  const deviceName =
    accountDeviceName ||
    scopedEnv.deviceName ||
    clean(matrix.deviceName) ||
    globalEnv.deviceName ||
    undefined;

  const accountInitialSyncLimit =
    typeof account.initialSyncLimit === "number"
      ? Math.max(0, Math.floor(account.initialSyncLimit))
      : undefined;
  const initialSyncLimit =
    accountInitialSyncLimit ??
    (typeof matrix.initialSyncLimit === "number"
      ? Math.max(0, Math.floor(matrix.initialSyncLimit))
      : undefined);
  const encryption =
    typeof account.encryption === "boolean" ? account.encryption : (matrix.encryption ?? false);

  return {
    homeserver,
    userId,
    accessToken,
    password,
    deviceId,
    deviceName,
    initialSyncLimit,
    encryption,
  };
}

export async function resolveMatrixAuth(params?: {
  cfg?: CoreConfig;
  env?: NodeJS.ProcessEnv;
  accountId?: string | null;
}): Promise<MatrixAuth> {
  const cfg = params?.cfg ?? (getMatrixRuntime().config.loadConfig() as CoreConfig);
  const env = params?.env ?? process.env;
  const accountId = params?.accountId;
  const resolved = accountId
    ? resolveMatrixConfigForAccount(cfg, accountId, env)
    : resolveMatrixConfig(cfg, env);
  if (!resolved.homeserver) {
    throw new Error("Matrix homeserver is required (matrix-js.homeserver)");
  }

  const {
    loadMatrixCredentials,
    saveMatrixCredentials,
    credentialsMatchConfig,
    touchMatrixCredentials,
  } = await import("../credentials.js");

  const cached = loadMatrixCredentials(env, accountId);
  const cachedCredentials =
    cached &&
    credentialsMatchConfig(cached, {
      homeserver: resolved.homeserver,
      userId: resolved.userId || "",
    })
      ? cached
      : null;

  // If we have an access token, we can fetch userId via whoami if not provided
  if (resolved.accessToken) {
    let userId = resolved.userId;
    const hasMatchingCachedToken = cachedCredentials?.accessToken === resolved.accessToken;
    let knownDeviceId = hasMatchingCachedToken
      ? cachedCredentials?.deviceId || resolved.deviceId
      : resolved.deviceId;

    if (!userId || !knownDeviceId) {
      // Fetch whoami when we need to resolve userId and/or deviceId from token auth.
      ensureMatrixSdkLoggingConfigured();
      const tempClient = new MatrixClient(resolved.homeserver, resolved.accessToken);
      const whoami = (await tempClient.doRequest("GET", "/_matrix/client/v3/account/whoami")) as {
        user_id?: string;
        device_id?: string;
      };
      if (!userId) {
        const fetchedUserId = whoami.user_id?.trim();
        if (!fetchedUserId) {
          throw new Error("Matrix whoami did not return user_id");
        }
        userId = fetchedUserId;
      }
      if (!knownDeviceId) {
        knownDeviceId = whoami.device_id?.trim() || resolved.deviceId;
      }
    }

    const shouldRefreshCachedCredentials =
      !cachedCredentials ||
      !hasMatchingCachedToken ||
      cachedCredentials.userId !== userId ||
      (cachedCredentials.deviceId || undefined) !== knownDeviceId;
    if (shouldRefreshCachedCredentials) {
      await saveMatrixCredentials(
        {
          homeserver: resolved.homeserver,
          userId,
          accessToken: resolved.accessToken,
          deviceId: knownDeviceId,
        },
        env,
        accountId,
      );
    } else if (hasMatchingCachedToken) {
      await touchMatrixCredentials(env, accountId);
    }
    return {
      homeserver: resolved.homeserver,
      userId,
      accessToken: resolved.accessToken,
      password: resolved.password,
      deviceId: knownDeviceId,
      deviceName: resolved.deviceName,
      initialSyncLimit: resolved.initialSyncLimit,
      encryption: resolved.encryption,
    };
  }

  if (cachedCredentials) {
    await touchMatrixCredentials(env, accountId);
    return {
      homeserver: cachedCredentials.homeserver,
      userId: cachedCredentials.userId,
      accessToken: cachedCredentials.accessToken,
      password: resolved.password,
      deviceId: cachedCredentials.deviceId || resolved.deviceId,
      deviceName: resolved.deviceName,
      initialSyncLimit: resolved.initialSyncLimit,
      encryption: resolved.encryption,
    };
  }

  if (!resolved.userId) {
    throw new Error(
      "Matrix userId is required when no access token is configured (matrix-js.userId)",
    );
  }

  if (!resolved.password) {
    throw new Error(
      "Matrix password is required when no access token is configured (matrix-js.password)",
    );
  }

  // Login with password using the same hardened request path as other Matrix HTTP calls.
  ensureMatrixSdkLoggingConfigured();
  const loginClient = new MatrixClient(resolved.homeserver, "");
  const login = (await loginClient.doRequest("POST", "/_matrix/client/v3/login", undefined, {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: resolved.userId },
    password: resolved.password,
    device_id: resolved.deviceId,
    initial_device_display_name: resolved.deviceName ?? "OpenClaw Gateway",
  })) as {
    access_token?: string;
    user_id?: string;
    device_id?: string;
  };

  const accessToken = login.access_token?.trim();
  if (!accessToken) {
    throw new Error("Matrix login did not return an access token");
  }

  const auth: MatrixAuth = {
    homeserver: resolved.homeserver,
    userId: login.user_id ?? resolved.userId,
    accessToken,
    password: resolved.password,
    deviceId: login.device_id ?? resolved.deviceId,
    deviceName: resolved.deviceName,
    initialSyncLimit: resolved.initialSyncLimit,
    encryption: resolved.encryption,
  };

  await saveMatrixCredentials(
    {
      homeserver: auth.homeserver,
      userId: auth.userId,
      accessToken: auth.accessToken,
      deviceId: auth.deviceId,
    },
    env,
    accountId,
  );

  return auth;
}
