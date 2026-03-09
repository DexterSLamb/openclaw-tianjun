import { getMatrixRuntime } from "../runtime.js";
import type { CoreConfig } from "../types.js";
import { getActiveMatrixClient } from "./active-client.js";
import {
  createMatrixClient,
  isBunRuntime,
  resolveMatrixAuth,
  resolveMatrixAuthContext,
} from "./client.js";
import type { MatrixClient } from "./sdk.js";

export type ResolvedRuntimeMatrixClient = {
  client: MatrixClient;
  stopOnDone: boolean;
};

type MatrixResolvedClientHook = (
  client: MatrixClient,
  context: { createdForOneOff: boolean },
) => Promise<void> | void;

export function ensureMatrixNodeRuntime() {
  if (isBunRuntime()) {
    throw new Error("Matrix support requires Node (bun runtime not supported)");
  }
}

export async function resolveRuntimeMatrixClient(opts: {
  client?: MatrixClient;
  timeoutMs?: number;
  accountId?: string | null;
  onResolved?: MatrixResolvedClientHook;
}): Promise<ResolvedRuntimeMatrixClient> {
  ensureMatrixNodeRuntime();
  if (opts.client) {
    await opts.onResolved?.(opts.client, { createdForOneOff: false });
    return { client: opts.client, stopOnDone: false };
  }

  const cfg = getMatrixRuntime().config.loadConfig() as CoreConfig;
  const authContext = resolveMatrixAuthContext({
    cfg,
    accountId: opts.accountId,
  });
  const active = getActiveMatrixClient(authContext.accountId);
  if (active) {
    await opts.onResolved?.(active, { createdForOneOff: false });
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
  await opts.onResolved?.(client, { createdForOneOff: true });
  return { client, stopOnDone: true };
}
