import { describe, expect, it, vi } from "vitest";
import { createMatrixRoomMessageHandler } from "./handler.js";
import { EventType, type MatrixRawEvent } from "./types.js";

const sendMessageMatrixMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ messageId: "evt", roomId: "!room" })),
);

vi.mock("../send.js", () => ({
  reactMatrixMessage: vi.fn(async () => {}),
  sendMessageMatrix: sendMessageMatrixMock,
  sendReadReceiptMatrix: vi.fn(async () => {}),
  sendTypingMatrix: vi.fn(async () => {}),
}));

describe("matrix monitor handler pairing account scope", () => {
  it("caches account-scoped allowFrom store reads on hot path", async () => {
    const readAllowFromStore = vi.fn(async () => [] as string[]);
    const upsertPairingRequest = vi.fn(async () => ({ code: "ABCDEFGH", created: false }));
    sendMessageMatrixMock.mockClear();

    const handler = createMatrixRoomMessageHandler({
      client: {
        getUserId: async () => "@bot:example.org",
      } as never,
      core: {
        channel: {
          pairing: {
            readAllowFromStore,
            upsertPairingRequest,
            buildPairingReply: () => "pairing",
          },
        },
      } as never,
      cfg: {} as never,
      accountId: "ops",
      runtime: {} as never,
      logger: {
        info: () => {},
        warn: () => {},
      } as never,
      logVerboseMessage: () => {},
      allowFrom: [],
      mentionRegexes: [],
      groupPolicy: "open",
      replyToMode: "off",
      threadReplies: "inbound",
      dmEnabled: true,
      dmPolicy: "pairing",
      textLimit: 8_000,
      mediaMaxBytes: 10_000_000,
      startupMs: 0,
      startupGraceMs: 0,
      directTracker: {
        isDirectMessage: async () => true,
      },
      getRoomInfo: async () => ({ altAliases: [] }),
      getMemberDisplayName: async () => "sender",
    });

    await handler("!room:example.org", {
      type: EventType.RoomMessage,
      sender: "@user:example.org",
      event_id: "$event1",
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.text",
        body: "hello",
        "m.mentions": { room: true },
      },
    } as MatrixRawEvent);

    await handler("!room:example.org", {
      type: EventType.RoomMessage,
      sender: "@user:example.org",
      event_id: "$event2",
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.text",
        body: "hello again",
        "m.mentions": { room: true },
      },
    } as MatrixRawEvent);

    expect(readAllowFromStore).toHaveBeenCalledTimes(1);
  });

  it("sends pairing reminders for pending requests with cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    try {
      const readAllowFromStore = vi.fn(async () => [] as string[]);
      const upsertPairingRequest = vi.fn(async () => ({ code: "ABCDEFGH", created: false }));
      sendMessageMatrixMock.mockClear();

      const handler = createMatrixRoomMessageHandler({
        client: {
          getUserId: async () => "@bot:example.org",
        } as never,
        core: {
          channel: {
            pairing: {
              readAllowFromStore,
              upsertPairingRequest,
              buildPairingReply: () => "Pairing code: ABCDEFGH",
            },
          },
        } as never,
        cfg: {} as never,
        accountId: "ops",
        runtime: {} as never,
        logger: {
          info: () => {},
          warn: () => {},
        } as never,
        logVerboseMessage: () => {},
        allowFrom: [],
        mentionRegexes: [],
        groupPolicy: "open",
        replyToMode: "off",
        threadReplies: "inbound",
        dmEnabled: true,
        dmPolicy: "pairing",
        textLimit: 8_000,
        mediaMaxBytes: 10_000_000,
        startupMs: 0,
        startupGraceMs: 0,
        directTracker: {
          isDirectMessage: async () => true,
        },
        getRoomInfo: async () => ({ altAliases: [] }),
        getMemberDisplayName: async () => "sender",
      });

      const makeEvent = (id: string): MatrixRawEvent =>
        ({
          type: EventType.RoomMessage,
          sender: "@user:example.org",
          event_id: id,
          origin_server_ts: Date.now(),
          content: {
            msgtype: "m.text",
            body: "hello",
            "m.mentions": { room: true },
          },
        }) as MatrixRawEvent;

      await handler("!room:example.org", makeEvent("$event1"));
      await handler("!room:example.org", makeEvent("$event2"));
      expect(sendMessageMatrixMock).toHaveBeenCalledTimes(1);
      expect(String(sendMessageMatrixMock.mock.calls[0]?.[1] ?? "")).toContain(
        "Pairing request is still pending approval.",
      );

      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
      await handler("!room:example.org", makeEvent("$event3"));
      expect(sendMessageMatrixMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses account-scoped pairing store reads and upserts for dm pairing", async () => {
    const readAllowFromStore = vi.fn(async () => [] as string[]);
    const upsertPairingRequest = vi.fn(async () => ({ code: "ABCDEFGH", created: false }));

    const handler = createMatrixRoomMessageHandler({
      client: {
        getUserId: async () => "@bot:example.org",
      } as never,
      core: {
        channel: {
          pairing: {
            readAllowFromStore,
            upsertPairingRequest,
          },
        },
      } as never,
      cfg: {} as never,
      accountId: "ops",
      runtime: {} as never,
      logger: {
        info: () => {},
        warn: () => {},
      } as never,
      logVerboseMessage: () => {},
      allowFrom: [],
      mentionRegexes: [],
      groupPolicy: "open",
      replyToMode: "off",
      threadReplies: "inbound",
      dmEnabled: true,
      dmPolicy: "pairing",
      textLimit: 8_000,
      mediaMaxBytes: 10_000_000,
      startupMs: 0,
      startupGraceMs: 0,
      directTracker: {
        isDirectMessage: async () => true,
      },
      getRoomInfo: async () => ({ altAliases: [] }),
      getMemberDisplayName: async () => "sender",
    });

    await handler("!room:example.org", {
      type: EventType.RoomMessage,
      sender: "@user:example.org",
      event_id: "$event1",
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.text",
        body: "hello",
        "m.mentions": { room: true },
      },
    } as MatrixRawEvent);

    expect(readAllowFromStore).toHaveBeenCalledWith({
      channel: "matrix-js",
      env: process.env,
      accountId: "ops",
    });
    expect(upsertPairingRequest).toHaveBeenCalledWith({
      channel: "matrix-js",
      id: "@user:example.org",
      accountId: "ops",
      meta: { name: "sender" },
    });
  });

  it("passes accountId into route resolution for inbound dm messages", async () => {
    const resolveAgentRoute = vi.fn(() => ({
      agentId: "ops",
      channel: "matrix-js",
      accountId: "ops",
      sessionKey: "agent:ops:main",
      mainSessionKey: "agent:ops:main",
      matchedBy: "binding.account",
    }));

    const handler = createMatrixRoomMessageHandler({
      client: {
        getUserId: async () => "@bot:example.org",
      } as never,
      core: {
        channel: {
          pairing: {
            readAllowFromStore: async () => [] as string[],
            upsertPairingRequest: async () => ({ code: "ABCDEFGH", created: false }),
          },
          commands: {
            shouldHandleTextCommands: () => false,
          },
          text: {
            hasControlCommand: () => false,
          },
          routing: {
            resolveAgentRoute,
          },
        },
      } as never,
      cfg: {} as never,
      accountId: "ops",
      runtime: {
        error: () => {},
      } as never,
      logger: {
        info: () => {},
        warn: () => {},
      } as never,
      logVerboseMessage: () => {},
      allowFrom: [],
      mentionRegexes: [],
      groupPolicy: "open",
      replyToMode: "off",
      threadReplies: "inbound",
      dmEnabled: true,
      dmPolicy: "open",
      textLimit: 8_000,
      mediaMaxBytes: 10_000_000,
      startupMs: 0,
      startupGraceMs: 0,
      directTracker: {
        isDirectMessage: async () => true,
      },
      getRoomInfo: async () => ({ altAliases: [] }),
      getMemberDisplayName: async () => "sender",
    });

    await handler("!room:example.org", {
      type: EventType.RoomMessage,
      sender: "@user:example.org",
      event_id: "$event2",
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.text",
        body: "hello",
        "m.mentions": { room: true },
      },
    } as MatrixRawEvent);

    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "matrix-js",
        accountId: "ops",
      }),
    );
  });
});
