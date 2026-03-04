import { readMatrixMessages } from "../src/matrix/actions.js";
import { createMatrixClient, resolveMatrixAuth } from "../src/matrix/client.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

async function main() {
  const roomId = process.argv[2]?.trim();
  if (!roomId) {
    throw new Error("Usage: bun extensions/matrix-js/scripts/live-read-room.ts <roomId> [limit]");
  }

  const requestedLimit = Number.parseInt(process.argv[3] ?? "30", 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 30;

  const base = resolveLiveHarnessConfig();
  const pluginCfg = installLiveHarnessRuntime(base);
  const auth = await resolveMatrixAuth({ cfg: pluginCfg as never });
  const client = await createMatrixClient({
    homeserver: auth.homeserver,
    userId: auth.userId,
    accessToken: auth.accessToken,
    password: auth.password,
    deviceId: auth.deviceId,
    encryption: false,
  });

  try {
    const result = await readMatrixMessages(roomId, { client, limit });
    const compact = result.messages.map((msg) => ({
      id: msg.eventId,
      sender: msg.sender,
      ts: msg.timestamp,
      text: msg.body ?? "",
    }));

    process.stdout.write(
      `${JSON.stringify(
        {
          roomId,
          count: compact.length,
          messages: compact,
          nextBatch: result.nextBatch ?? null,
          prevBatch: result.prevBatch ?? null,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    client.stop();
  }
}

main().catch((err) => {
  process.stderr.write(`READ_ROOM_ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
