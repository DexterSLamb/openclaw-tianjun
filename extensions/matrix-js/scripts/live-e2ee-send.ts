import { sendMatrixMessage } from "../src/matrix/actions.js";
import { createMatrixClient, resolveMatrixAuth } from "../src/matrix/client.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

const MEGOLM_ALG = "m.megolm.v1.aes-sha2";

type MatrixEventLike = {
  type?: string;
};

async function main() {
  const targetUserId = process.argv[2]?.trim() || "@user:example.org";
  const useFullBootstrap = process.argv.includes("--full-bootstrap");
  const startupTimeoutMs = 45_000;
  const base = resolveLiveHarnessConfig();
  const pluginCfg = installLiveHarnessRuntime(base);

  // Enable encryption for this run only.
  (pluginCfg.channels["matrix-js"] as { encryption: boolean }).encryption = true;

  const auth = await resolveMatrixAuth({ cfg: pluginCfg as never });
  const client = await createMatrixClient({
    homeserver: auth.homeserver,
    userId: auth.userId,
    accessToken: auth.accessToken,
    password: auth.password,
    deviceId: auth.deviceId,
    encryption: true,
  });

  const stamp = new Date().toISOString();

  try {
    if (!useFullBootstrap) {
      const bootstrapper = (
        client as unknown as { cryptoBootstrapper?: { bootstrap?: () => Promise<void> } }
      ).cryptoBootstrapper;
      if (bootstrapper?.bootstrap) {
        bootstrapper.bootstrap = async () => {};
      }
    }

    await Promise.race([
      client.start(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Matrix client start timed out after ${startupTimeoutMs}ms (fullBootstrap=${useFullBootstrap})`,
            ),
          );
        }, startupTimeoutMs);
      }),
    ]);

    const dmRoomCreate = (await client.doRequest(
      "POST",
      "/_matrix/client/v3/createRoom",
      undefined,
      {
        is_direct: true,
        invite: [targetUserId],
        preset: "trusted_private_chat",
        name: `OpenClaw E2EE DM ${stamp}`,
        topic: "matrix-js E2EE DM test",
        initial_state: [
          {
            type: "m.room.encryption",
            state_key: "",
            content: {
              algorithm: MEGOLM_ALG,
            },
          },
        ],
      },
    )) as { room_id?: string };

    const dmRoomId = dmRoomCreate.room_id?.trim() ?? "";
    if (!dmRoomId) {
      throw new Error("Failed to create encrypted DM room");
    }

    const currentDirect = ((await client.getAccountData("m.direct").catch(() => ({}))) ??
      {}) as Record<string, string[]>;
    const existing = Array.isArray(currentDirect[targetUserId]) ? currentDirect[targetUserId] : [];
    await client.setAccountData("m.direct", {
      ...currentDirect,
      [targetUserId]: [dmRoomId, ...existing.filter((id) => id !== dmRoomId)],
    });

    const dmSend = await sendMatrixMessage(
      dmRoomId,
      `Matrix-js E2EE DM test ${stamp}\nPlease reply here so I can validate decrypt/read.`,
      {
        client,
      },
    );

    const roomCreate = (await client.doRequest("POST", "/_matrix/client/v3/createRoom", undefined, {
      invite: [targetUserId],
      preset: "private_chat",
      name: `OpenClaw E2EE Room ${stamp}`,
      topic: "matrix-js E2EE room test",
      initial_state: [
        {
          type: "m.room.encryption",
          state_key: "",
          content: {
            algorithm: MEGOLM_ALG,
          },
        },
      ],
    })) as { room_id?: string };

    const roomId = roomCreate.room_id?.trim() ?? "";
    if (!roomId) {
      throw new Error("Failed to create encrypted room chat");
    }

    const roomSend = await sendMatrixMessage(
      roomId,
      `Matrix-js E2EE room test ${stamp}\nPlease reply here too.`,
      {
        client,
      },
    );

    const dmRaw = (await client.doRequest(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(dmRoomId)}/event/${encodeURIComponent(dmSend.messageId)}`,
    )) as MatrixEventLike;

    const roomRaw = (await client.doRequest(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(roomSend.messageId)}`,
    )) as MatrixEventLike;

    process.stdout.write(
      `${JSON.stringify(
        {
          homeserver: base.homeserver,
          senderUserId: base.userId,
          targetUserId,
          encryptionAlgorithm: MEGOLM_ALG,
          fullBootstrap: useFullBootstrap,
          dm: {
            roomId: dmRoomId,
            messageId: dmSend.messageId,
            storedEventType: dmRaw.type ?? null,
          },
          room: {
            roomId,
            messageId: roomSend.messageId,
            storedEventType: roomRaw.type ?? null,
          },
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
  process.stderr.write(`E2EE_SEND_ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
