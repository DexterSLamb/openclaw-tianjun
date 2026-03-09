import { getMatrixRuntime } from "../../runtime.js";
import type { CoreConfig } from "../../types.js";
import { resolveMatrixAccountConfig } from "../accounts.js";
import { getActiveMatrixClient } from "../active-client.js";
import {
  createMatrixClient,
  isBunRuntime,
  resolveMatrixAuth,
  resolveMatrixAuthContext,
} from "../client.js";
import type { MatrixClient } from "../sdk.js";

const getCore = () => getMatrixRuntime();

export function ensureNodeRuntime() {
  if (isBunRuntime()) {
    throw new Error("Matrix support requires Node (bun runtime not supported)");
  }
}

export function resolveMediaMaxBytes(accountId?: string | null): number | undefined {
  const cfg = getCore().config.loadConfig() as CoreConfig;
  const matrixCfg = resolveMatrixAccountConfig({ cfg, accountId });
  const mediaMaxMb = typeof matrixCfg.mediaMaxMb === "number" ? matrixCfg.mediaMaxMb : undefined;
  if (typeof mediaMaxMb === "number") {
    return mediaMaxMb * 1024 * 1024;
  }
  return undefined;
}

export async function resolveMatrixClient(opts: {
  client?: MatrixClient;
  timeoutMs?: number;
  accountId?: string | null;
}): Promise<{ client: MatrixClient; stopOnDone: boolean }> {
  ensureNodeRuntime();
  if (opts.client) {
    return { client: opts.client, stopOnDone: false };
  }
  const cfg = getCore().config.loadConfig() as CoreConfig;
  const authContext = resolveMatrixAuthContext({
    cfg,
    accountId: opts.accountId,
  });
  const active = getActiveMatrixClient(authContext.accountId);
  if (active) {
    return { client: active, stopOnDone: false };
  }
  const auth = await resolveMatrixAuth({
    cfg,
    accountId: authContext.accountId,
  });
  const client = await createMatrixClient({
    homeserver: auth.homeserver,
    userId: auth.userId,
    accessToken: auth.accessToken,
    password: auth.password,
    deviceId: auth.deviceId,
    encryption: auth.encryption,
    localTimeoutMs: opts.timeoutMs,
    accountId: auth.accountId,
    autoBootstrapCrypto: false,
  });
  await client.prepareForOneOff();
  return { client, stopOnDone: true };
}
