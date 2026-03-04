import { describe, expect, it, vi } from "vitest";
import type { MatrixAuth } from "../client.js";
import type { MatrixClient } from "../sdk.js";
import { registerMatrixMonitorEvents } from "./events.js";
import type { MatrixRawEvent } from "./types.js";
import { EventType } from "./types.js";

type RoomEventListener = (roomId: string, event: MatrixRawEvent) => void;

function getSentNoticeBody(sendMessage: ReturnType<typeof vi.fn>, index = 0): string {
  const calls = sendMessage.mock.calls as unknown[][];
  const payload = (calls[index]?.[1] ?? {}) as { body?: string };
  return payload.body ?? "";
}

function createHarness(params?: {
  verifications?: Array<{
    id: string;
    transactionId?: string;
    roomId?: string;
    otherUserId: string;
    phaseName: string;
    updatedAt?: string;
    completed?: boolean;
    sas?: {
      decimal?: [number, number, number];
      emoji?: Array<[string, string]>;
    };
  }>;
}) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const onRoomMessage = vi.fn(async () => {});
  const listVerifications = vi.fn(async () => params?.verifications ?? []);
  const sendMessage = vi.fn(async () => "$notice");
  const client = {
    on: vi.fn((eventName: string, listener: (...args: unknown[]) => void) => {
      listeners.set(eventName, listener);
      return client;
    }),
    sendMessage,
    crypto: {
      listVerifications,
    },
  } as unknown as MatrixClient;

  registerMatrixMonitorEvents({
    client,
    auth: { encryption: true } as MatrixAuth,
    logVerboseMessage: vi.fn(),
    warnedEncryptedRooms: new Set<string>(),
    warnedCryptoMissingRooms: new Set<string>(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    formatNativeDependencyHint: vi.fn(() => "install hint"),
    onRoomMessage,
  });

  const roomEventListener = listeners.get("room.event") as RoomEventListener | undefined;
  if (!roomEventListener) {
    throw new Error("room.event listener was not registered");
  }

  return {
    onRoomMessage,
    sendMessage,
    roomEventListener,
    listVerifications,
    roomMessageListener: listeners.get("room.message") as RoomEventListener | undefined,
  };
}

describe("registerMatrixMonitorEvents verification routing", () => {
  it("posts verification request notices directly into the room", async () => {
    const { onRoomMessage, sendMessage, roomMessageListener } = createHarness();
    if (!roomMessageListener) {
      throw new Error("room.message listener was not registered");
    }
    roomMessageListener("!room:example.org", {
      event_id: "$req1",
      sender: "@alice:example.org",
      type: EventType.RoomMessage,
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.key.verification.request",
        body: "verification request",
      },
    });

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(onRoomMessage).not.toHaveBeenCalled();
    const body = getSentNoticeBody(sendMessage, 0);
    expect(body).toContain("Matrix verification request received from @alice:example.org.");
    expect(body).toContain('Open "Verify by emoji"');
  });

  it("posts ready-stage guidance for emoji verification", async () => {
    const { sendMessage, roomEventListener } = createHarness();
    roomEventListener("!room:example.org", {
      event_id: "$ready-1",
      sender: "@alice:example.org",
      type: "m.key.verification.ready",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": { event_id: "$req-ready-1" },
      },
    });

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    const body = getSentNoticeBody(sendMessage, 0);
    expect(body).toContain("Matrix verification is ready with @alice:example.org.");
    expect(body).toContain('Choose "Verify by emoji"');
  });

  it("posts SAS emoji/decimal details when verification summaries expose them", async () => {
    const { sendMessage, roomEventListener, listVerifications } = createHarness({
      verifications: [
        {
          id: "verification-1",
          transactionId: "$different-flow-id",
          updatedAt: new Date("2026-02-25T21:42:54.000Z").toISOString(),
          otherUserId: "@alice:example.org",
          phaseName: "started",
          sas: {
            decimal: [6158, 1986, 3513],
            emoji: [
              ["🎁", "Gift"],
              ["🌍", "Globe"],
              ["🐴", "Horse"],
            ],
          },
        },
      ],
    });

    roomEventListener("!room:example.org", {
      event_id: "$start2",
      sender: "@alice:example.org",
      type: "m.key.verification.start",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": { event_id: "$req2" },
      },
    });

    await vi.waitFor(() => {
      const bodies = (sendMessage.mock.calls as unknown[][]).map((call) =>
        String((call[1] as { body?: string } | undefined)?.body ?? ""),
      );
      expect(bodies.some((body) => body.includes("SAS emoji:"))).toBe(true);
      expect(bodies.some((body) => body.includes("SAS decimal: 6158 1986 3513"))).toBe(true);
    });
  });

  it("does not emit duplicate SAS notices for the same verification payload", async () => {
    const { sendMessage, roomEventListener, listVerifications } = createHarness({
      verifications: [
        {
          id: "verification-3",
          transactionId: "$req3",
          otherUserId: "@alice:example.org",
          phaseName: "started",
          sas: {
            decimal: [1111, 2222, 3333],
            emoji: [
              ["🚀", "Rocket"],
              ["🦋", "Butterfly"],
              ["📕", "Book"],
            ],
          },
        },
      ],
    });

    roomEventListener("!room:example.org", {
      event_id: "$start3",
      sender: "@alice:example.org",
      type: "m.key.verification.start",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": { event_id: "$req3" },
      },
    });
    await vi.waitFor(() => {
      expect(sendMessage.mock.calls.length).toBeGreaterThan(0);
    });

    roomEventListener("!room:example.org", {
      event_id: "$key3",
      sender: "@alice:example.org",
      type: "m.key.verification.key",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": { event_id: "$req3" },
      },
    });
    await vi.waitFor(() => {
      expect(listVerifications).toHaveBeenCalledTimes(2);
    });

    const sasBodies = sendMessage.mock.calls
      .map((call) => String(((call as unknown[])[1] as { body?: string } | undefined)?.body ?? ""))
      .filter((body) => body.includes("SAS emoji:"));
    expect(sasBodies).toHaveLength(1);
  });
});
