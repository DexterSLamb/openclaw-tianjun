import { createMatrixClient, resolveMatrixAuth } from "../src/matrix/client.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

type MatrixRawEvent = {
  event_id?: string;
  type?: string;
  sender?: string;
  room_id?: string;
  origin_server_ts?: number;
  content?: {
    body?: string;
    msgtype?: string;
  };
};

async function main() {
  const roomId = process.argv[2]?.trim();
  const targetUserId = process.argv[3]?.trim() || "@user:example.org";
  const timeoutSecRaw = Number.parseInt(process.argv[4] ?? "120", 10);
  const timeoutMs =
    (Number.isFinite(timeoutSecRaw) && timeoutSecRaw > 0 ? timeoutSecRaw : 120) * 1000;
  const useFullBootstrap = process.argv.includes("--full-bootstrap");
  const startupTimeoutMs = 45_000;

  if (!roomId) {
    throw new Error(
      "Usage: node --import tsx extensions/matrix-js/scripts/live-e2ee-wait-reply.ts <roomId> [targetUserId] [timeoutSec] [--full-bootstrap]",
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

    const found = await new Promise<MatrixRawEvent | null>((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      client.on("room.message", (eventRoomId, event) => {
        const rid = String(eventRoomId || "");
        const raw = event as MatrixRawEvent;
        if (rid !== roomId) {
          return;
        }
        if ((raw.sender ?? "").trim() !== targetUserId) {
          return;
        }
        if ((raw.type ?? "").trim() !== "m.room.message") {
          return;
        }
        clearTimeout(timer);
        resolve(raw);
      });
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          roomId,
          targetUserId,
          timeoutMs,
          found: Boolean(found),
          message: found
            ? {
                eventId: found.event_id ?? null,
                type: found.type ?? null,
                sender: found.sender ?? null,
                timestamp: found.origin_server_ts ?? null,
                text: found.content?.body ?? null,
                msgtype: found.content?.msgtype ?? null,
              }
            : null,
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
    `E2EE_WAIT_REPLY_ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
