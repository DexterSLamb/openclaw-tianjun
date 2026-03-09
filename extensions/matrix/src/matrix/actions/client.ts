import { ensureMatrixNodeRuntime, resolveRuntimeMatrixClient } from "../client-bootstrap.js";
import type { MatrixActionClient, MatrixActionClientOpts } from "./types.js";

export function ensureNodeRuntime() {
  ensureMatrixNodeRuntime();
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
  return await resolveRuntimeMatrixClient({
    client: opts.client,
    timeoutMs: opts.timeoutMs,
    accountId: opts.accountId,
    onResolved: async (client, context) => {
      await ensureActionClientReadiness(client, opts.readiness, {
        createdForOneOff: context.createdForOneOff,
      });
    },
  });
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
