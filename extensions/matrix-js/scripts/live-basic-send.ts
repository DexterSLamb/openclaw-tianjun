import { sendMatrixMessage } from "../src/matrix/actions.js";
import { createMatrixClient, resolveMatrixAuth } from "../src/matrix/client.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

async function main() {
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

  const targetUserId = process.argv[2]?.trim() || "@user:example.org";
  const stamp = new Date().toISOString();

  try {
    const dmRoomCreate = (await client.doRequest(
      "POST",
      "/_matrix/client/v3/createRoom",
      undefined,
      {
        is_direct: true,
        invite: [targetUserId],
        preset: "trusted_private_chat",
        name: `OpenClaw DM Test ${stamp}`,
        topic: "matrix-js basic DM messaging test",
      },
    )) as { room_id?: string };

    const dmRoomId = dmRoomCreate.room_id?.trim() ?? "";
    if (!dmRoomId) {
      throw new Error("Failed to create DM room");
    }

    const currentDirect = ((await client.getAccountData("m.direct").catch(() => ({}))) ??
      {}) as Record<string, string[]>;
    const existing = Array.isArray(currentDirect[targetUserId]) ? currentDirect[targetUserId] : [];
    await client.setAccountData("m.direct", {
      ...currentDirect,
      [targetUserId]: [dmRoomId, ...existing.filter((id) => id !== dmRoomId)],
    });

    const dmByUserTarget = await sendMatrixMessage(
      targetUserId,
      `Matrix-js basic DM test (user target) ${stamp}`,
      { client },
    );
    const dmByRoomTarget = await sendMatrixMessage(
      dmRoomId,
      `Matrix-js basic DM test (room target) ${stamp}`,
      { client },
    );

    const roomCreate = (await client.doRequest("POST", "/_matrix/client/v3/createRoom", undefined, {
      invite: [targetUserId],
      preset: "private_chat",
      name: `OpenClaw Room Test ${stamp}`,
      topic: "matrix-js basic room messaging test",
    })) as { room_id?: string };

    const roomId = roomCreate.room_id?.trim() ?? "";
    if (!roomId) {
      throw new Error("Failed to create room chat room");
    }

    const roomSend = await sendMatrixMessage(roomId, `Matrix-js basic room test ${stamp}`, {
      client,
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          homeserver: base.homeserver,
          senderUserId: base.userId,
          targetUserId,
          dm: {
            roomId: dmRoomId,
            userTargetMessageId: dmByUserTarget.messageId,
            roomTargetMessageId: dmByRoomTarget.messageId,
          },
          room: {
            roomId,
            messageId: roomSend.messageId,
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
  process.stderr.write(`BASIC_SEND_ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
