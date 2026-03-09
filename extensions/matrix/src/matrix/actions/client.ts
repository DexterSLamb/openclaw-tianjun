import { resolveRuntimeMatrixClient } from "../client-bootstrap.js";
import { resolveMatrixRoomId } from "../send.js";
import type { MatrixActionClient, MatrixActionClientOpts } from "./types.js";

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

type MatrixActionClientStopMode = "stop" | "persist";

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

export async function withStartedActionClient<T>(
  opts: MatrixActionClientOpts,
  run: (client: MatrixActionClient["client"]) => Promise<T>,
): Promise<T> {
  return await withResolvedActionClient({ ...opts, readiness: "started" }, run, "persist");
}

export async function withResolvedRoomAction<T>(
  roomId: string,
  opts: MatrixActionClientOpts,
  run: (client: MatrixActionClient["client"], resolvedRoom: string) => Promise<T>,
): Promise<T> {
  return await withResolvedActionClient(opts, async (client) => {
    const resolvedRoom = await resolveMatrixRoomId(client, roomId);
    return await run(client, resolvedRoom);
  });
}
