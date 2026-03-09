import { getMatrixRuntime } from "../../runtime.js";
import type { CoreConfig } from "../../types.js";
import { getActiveMatrixClient } from "../active-client.js";
import {
  createMatrixClient,
  isBunRuntime,
  resolveMatrixAuth,
  resolveMatrixAuthContext,
} from "../client.js";
import type { MatrixActionClient, MatrixActionClientOpts } from "./types.js";

export function ensureNodeRuntime() {
  if (isBunRuntime()) {
    throw new Error("Matrix support requires Node (bun runtime not supported)");
  }
}

async function ensureActionClientReadiness(
  client: MatrixActionClient["client"],
  readiness: MatrixActionClientOpts["readiness"],
  opts: { createdForOneOff: boolean },
): Promise<void> {
  if (readiness === "started") {
    await client.start();
    return;
  }
  if (readiness === "prepared" || (!readiness && opts.createdForOneOff)) {
    await client.prepareForOneOff();
  }
}

export async function resolveActionClient(
  opts: MatrixActionClientOpts = {},
): Promise<MatrixActionClient> {
  ensureNodeRuntime();
  if (opts.client) {
    await ensureActionClientReadiness(opts.client, opts.readiness, {
      createdForOneOff: false,
    });
    return { client: opts.client, stopOnDone: false };
  }
  const cfg = getMatrixRuntime().config.loadConfig() as CoreConfig;
  const authContext = resolveMatrixAuthContext({
    cfg,
    accountId: opts.accountId,
  });
  const active = getActiveMatrixClient(authContext.accountId);
  if (active) {
    await ensureActionClientReadiness(active, opts.readiness, {
      createdForOneOff: false,
    });
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
  await ensureActionClientReadiness(client, opts.readiness, {
    createdForOneOff: true,
  });
  return { client, stopOnDone: true };
}

export type MatrixActionClientStopMode = "stop" | "persist";

export async function stopActionClient(
  resolved: MatrixActionClient,
  mode: MatrixActionClientStopMode = "stop",
): Promise<void> {
  if (!resolved.stopOnDone) {
    return;
  }
  if (mode === "persist") {
    await resolved.client.stopAndPersist();
    return;
  }
  resolved.client.stop();
}

export async function withResolvedActionClient<T>(
  opts: MatrixActionClientOpts,
  run: (client: MatrixActionClient["client"]) => Promise<T>,
  mode: MatrixActionClientStopMode = "stop",
): Promise<T> {
  const resolved = await resolveActionClient(opts);
  try {
    return await run(resolved.client);
  } finally {
    await stopActionClient(resolved, mode);
  }
}
