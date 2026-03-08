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

function createReactionHarness(params?: {
  cfg?: unknown;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: string[];
  storeAllowFrom?: string[];
  targetSender?: string;
  isDirectMessage?: boolean;
  senderName?: string;
}) {
  const readAllowFromStore = vi.fn(async () => params?.storeAllowFrom ?? []);
  const upsertPairingRequest = vi.fn(async () => ({ code: "ABCDEFGH", created: false }));
  const resolveAgentRoute = vi.fn(() => ({
    agentId: "ops",
    channel: "matrix-js",
    accountId: "ops",
    sessionKey: "agent:ops:main",
    mainSessionKey: "agent:ops:main",
    matchedBy: "binding.account",
  }));
  const enqueueSystemEvent = vi.fn();

  const handler = createMatrixRoomMessageHandler({
    client: {
      getUserId: async () => "@bot:example.org",
      getEvent: async () => ({ sender: params?.targetSender ?? "@bot:example.org" }),
    } as never,
    core: {
      channel: {
        pairing: {
          readAllowFromStore,
          upsertPairingRequest,
          buildPairingReply: () => "pairing",
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
      system: {
        enqueueSystemEvent,
      },
    } as never,
    cfg: (params?.cfg ?? {}) as never,
    accountId: "ops",
    runtime: {
      error: () => {},
    } as never,
    logger: {
      info: () => {},
      warn: () => {},
    } as never,
    logVerboseMessage: () => {},
    allowFrom: params?.allowFrom ?? [],
    mentionRegexes: [],
    groupPolicy: "open",
    replyToMode: "off",
    threadReplies: "inbound",
    dmEnabled: true,
    dmPolicy: params?.dmPolicy ?? "open",
    textLimit: 8_000,
    mediaMaxBytes: 10_000_000,
    startupMs: 0,
    startupGraceMs: 0,
    directTracker: {
      isDirectMessage: async () => params?.isDirectMessage ?? true,
    },
    getRoomInfo: async () => ({ altAliases: [] }),
    getMemberDisplayName: async () => params?.senderName ?? "sender",
  });

  return {
    handler,
    enqueueSystemEvent,
    readAllowFromStore,
    resolveAgentRoute,
    upsertPairingRequest,
  };
}

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

  it("records thread starter context for inbound thread replies", async () => {
    const recordInboundSession = vi.fn(async () => {});
    const finalizeInboundContext = vi.fn((ctx) => ctx);

    const handler = createMatrixRoomMessageHandler({
      client: {
        getUserId: async () => "@bot:example.org",
        getEvent: async () => ({
          event_id: "$root",
          sender: "@alice:example.org",
          type: EventType.RoomMessage,
          origin_server_ts: Date.now(),
          content: {
            msgtype: "m.text",
            body: "Root topic",
          },
        }),
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
            resolveMarkdownTableMode: () => "preserve",
          },
          routing: {
            resolveAgentRoute: () => ({
              agentId: "ops",
              channel: "matrix-js",
              accountId: "ops",
              sessionKey: "agent:ops:main",
              mainSessionKey: "agent:ops:main",
              matchedBy: "binding.account",
            }),
          },
          session: {
            resolveStorePath: () => "/tmp/session-store",
            readSessionUpdatedAt: () => undefined,
            recordInboundSession,
          },
          reply: {
            resolveEnvelopeFormatOptions: () => ({}),
            formatAgentEnvelope: ({ body }: { body: string }) => body,
            finalizeInboundContext,
            createReplyDispatcherWithTyping: () => ({
              dispatcher: {},
              replyOptions: {},
              markDispatchIdle: () => {},
            }),
            resolveHumanDelayConfig: () => undefined,
            dispatchReplyFromConfig: async () => ({
              queuedFinal: false,
              counts: { final: 0, block: 0, tool: 0 },
            }),
          },
          reactions: {
            shouldAckReaction: () => false,
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
        isDirectMessage: async () => false,
      },
      getRoomInfo: async () => ({ altAliases: [] }),
      getMemberDisplayName: async (_roomId, userId) =>
        userId === "@alice:example.org" ? "Alice" : "sender",
    });

    await handler("!room:example.org", {
      type: EventType.RoomMessage,
      sender: "@user:example.org",
      event_id: "$reply1",
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.text",
        body: "follow up",
        "m.relates_to": {
          rel_type: "m.thread",
          event_id: "$root",
          "m.in_reply_to": { event_id: "$root" },
        },
        "m.mentions": { room: true },
      },
    } as MatrixRawEvent);

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageThreadId: "$root",
        ThreadStarterBody: "Matrix thread root $root from Alice:\nRoot topic",
      }),
    );
    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:ops:main",
      }),
    );
  });

  it("enqueues system events for reactions on bot-authored messages", async () => {
    const { handler, enqueueSystemEvent, resolveAgentRoute } = createReactionHarness();

    await handler("!room:example.org", {
      type: EventType.Reaction,
      sender: "@user:example.org",
      event_id: "$reaction1",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: "$msg1",
          key: "👍",
        },
      },
    } as MatrixRawEvent);

    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "matrix-js",
        accountId: "ops",
      }),
    );
    expect(enqueueSystemEvent).toHaveBeenCalledWith(
      "Matrix reaction added: 👍 by sender on msg $msg1",
      {
        sessionKey: "agent:ops:main",
        contextKey: "matrix:reaction:add:!room:example.org:$msg1:@user:example.org:👍",
      },
    );
  });

  it("ignores reactions that do not target bot-authored messages", async () => {
    const { handler, enqueueSystemEvent, resolveAgentRoute } = createReactionHarness({
      targetSender: "@other:example.org",
    });

    await handler("!room:example.org", {
      type: EventType.Reaction,
      sender: "@user:example.org",
      event_id: "$reaction2",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: "$msg2",
          key: "👀",
        },
      },
    } as MatrixRawEvent);

    expect(enqueueSystemEvent).not.toHaveBeenCalled();
    expect(resolveAgentRoute).not.toHaveBeenCalled();
  });

  it("does not create pairing requests for unauthorized dm reactions", async () => {
    const { handler, enqueueSystemEvent, upsertPairingRequest } = createReactionHarness({
      dmPolicy: "pairing",
    });

    await handler("!room:example.org", {
      type: EventType.Reaction,
      sender: "@user:example.org",
      event_id: "$reaction3",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: "$msg3",
          key: "🔥",
        },
      },
    } as MatrixRawEvent);

    expect(upsertPairingRequest).not.toHaveBeenCalled();
    expect(enqueueSystemEvent).not.toHaveBeenCalled();
  });

  it("honors account-scoped reaction notification overrides", async () => {
    const { handler, enqueueSystemEvent } = createReactionHarness({
      cfg: {
        channels: {
          "matrix-js": {
            reactionNotifications: "own",
            accounts: {
              ops: {
                reactionNotifications: "off",
              },
            },
          },
        },
      },
    });

    await handler("!room:example.org", {
      type: EventType.Reaction,
      sender: "@user:example.org",
      event_id: "$reaction4",
      origin_server_ts: Date.now(),
      content: {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: "$msg4",
          key: "✅",
        },
      },
    } as MatrixRawEvent);

    expect(enqueueSystemEvent).not.toHaveBeenCalled();
  });
});
