import { sendMatrixMessage } from "../src/matrix/actions.js";
import { createMatrixClient, resolveMatrixAuth } from "../src/matrix/client.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const roomId = process.argv[2]?.trim();
  const useFullBootstrap = process.argv.includes("--full-bootstrap");
  const startupTimeoutMs = 45_000;
  const settleMsRaw = Number.parseInt(process.argv[3] ?? "4000", 10);
  const settleMs = Number.isFinite(settleMsRaw) && settleMsRaw >= 0 ? settleMsRaw : 4000;

  if (!roomId) {
    throw new Error(
      "Usage: node --import tsx extensions/matrix-js/scripts/live-e2ee-send-room.ts <roomId> [settleMs] [--full-bootstrap]",
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

    if (settleMs > 0) {
      await delay(settleMs);
    }

    const sent = await sendMatrixMessage(
      roomId,
      `Matrix-js E2EE existing-room test ${stamp} (settleMs=${settleMs})`,
      { client },
    );

    const event = (await client.doRequest(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(sent.messageId)}`,
    )) as { type?: string };

    process.stdout.write(
      `${JSON.stringify(
        {
          roomId,
          messageId: sent.messageId,
          storedEventType: event.type ?? null,
          fullBootstrap: useFullBootstrap,
          settleMs,
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
    `E2EE_SEND_ROOM_ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
