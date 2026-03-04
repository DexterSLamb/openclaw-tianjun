import { createMatrixClient, resolveMatrixAuth } from "../src/matrix/client.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

async function main() {
  const roomId = process.argv[2]?.trim();
  const eventId = process.argv[3]?.trim();

  if (!roomId) {
    throw new Error(
      "Usage: node --import tsx extensions/matrix-js/scripts/live-e2ee-room-state.ts <roomId> [eventId]",
    );
  }

  const base = resolveLiveHarnessConfig();
  const pluginCfg = installLiveHarnessRuntime(base);
  (pluginCfg.channels["matrix-js"] as { encryption: boolean }).encryption = true;

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
    const encryptionState = (await client.doRequest(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption/`,
    )) as { algorithm?: string; rotation_period_ms?: number; rotation_period_msgs?: number };

    let eventType: string | null = null;
    if (eventId) {
      const event = (await client.doRequest(
        "GET",
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
      )) as { type?: string };
      eventType = event.type ?? null;
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          roomId,
          encryptionState,
          eventId: eventId ?? null,
          eventType,
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
  process.stderr.write(
    `E2EE_ROOM_STATE_ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
