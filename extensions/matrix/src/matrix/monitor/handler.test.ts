import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing as sessionBindingTesting,
  registerSessionBindingAdapter,
} from "../../../../../src/infra/outbound/session-binding-service.js";
import {
  createMatrixHandlerTestHarness,
  createMatrixReactionEvent,
  createMatrixTextMessageEvent,
} from "./handler.test-helpers.js";
import type { MatrixRawEvent } from "./types.js";

const sendMessageMatrixMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ messageId: "evt", roomId: "!room" })),
);

vi.mock("../send.js", () => ({
  reactMatrixMessage: vi.fn(async () => {}),
  sendMessageMatrix: sendMessageMatrixMock,
  sendReadReceiptMatrix: vi.fn(async () => {}),
  sendTypingMatrix: vi.fn(async () => {}),
}));

beforeEach(() => {
  sessionBindingTesting.resetSessionBindingAdaptersForTests();
});

function createReactionHarness(params?: {
  cfg?: unknown;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: string[];
  storeAllowFrom?: string[];
  targetSender?: string;
  isDirectMessage?: boolean;
  senderName?: string;
}) {
  return createMatrixHandlerTestHarness({
    cfg: params?.cfg,
    dmPolicy: params?.dmPolicy,
    allowFrom: params?.allowFrom,
    readAllowFromStore: vi.fn(async () => params?.storeAllowFrom ?? []),
    client: {
      getEvent: async () => ({ sender: params?.targetSender ?? "@bot:example.org" }),
    },
    isDirectMessage: params?.isDirectMessage,
    getMemberDisplayName: async () => params?.senderName ?? "sender",
  });
}

describe("matrix monitor handler pairing account scope", () => {
  it("caches account-scoped allowFrom store reads on hot path", async () => {
    const readAllowFromStore = vi.fn(async () => [] as string[]);
    sendMessageMatrixMock.mockClear();

    const { handler } = createMatrixHandlerTestHarness({
      readAllowFromStore,
      dmPolicy: "pairing",
      buildPairingReply: () => "pairing",
    });

    await handler(
      "!room:example.org",
      createMatrixTextMessageEvent({
        eventId: "$event1",
        body: "hello",
        mentions: { room: true },
      }),
    );

    await handler(
      "!room:example.org",
      createMatrixTextMessageEvent({
        eventId: "$event2",
        body: "hello again",
        mentions: { room: true },
      }),
    );

    expect(readAllowFromStore).toHaveBeenCalledTimes(1);
  });

  it("sends pairing reminders for pending requests with cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    try {
      const readAllowFromStore = vi.fn(async () => [] as string[]);
      sendMessageMatrixMock.mockClear();

      const { handler } = createMatrixHandlerTestHarness({
        readAllowFromStore,
        dmPolicy: "pairing",
        buildPairingReply: () => "Pairing code: ABCDEFGH",
        isDirectMessage: true,
        getMemberDisplayName: async () => "sender",
      });

      const makeEvent = (id: string): MatrixRawEvent =>
        createMatrixTextMessageEvent({
          eventId: id,
          body: "hello",
          mentions: { room: true },
        });

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

    const { handler } = createMatrixHandlerTestHarness({
      readAllowFromStore,
      upsertPairingRequest,
      dmPolicy: "pairing",
      isDirectMessage: true,
      getMemberDisplayName: async () => "sender",
    });

    await handler(
      "!room:example.org",
      createMatrixTextMessageEvent({
        eventId: "$event1",
        body: "hello",
        mentions: { room: true },
      }),
    );

    expect(readAllowFromStore).toHaveBeenCalledWith({
      channel: "matrix",
      env: process.env,
      accountId: "ops",
    });
    expect(upsertPairingRequest).toHaveBeenCalledWith({
      channel: "matrix",
      id: "@user:example.org",
      accountId: "ops",
      meta: { name: "sender" },
    });
  });

  it("passes accountId into route resolution for inbound dm messages", async () => {
    const resolveAgentRoute = vi.fn(() => ({
      agentId: "ops",
      channel: "matrix",
      accountId: "ops",
      sessionKey: "agent:ops:main",
      mainSessionKey: "agent:ops:main",
      matchedBy: "binding.account",
    }));

    const { handler } = createMatrixHandlerTestHarness({
      resolveAgentRoute,
      isDirectMessage: true,
      getMemberDisplayName: async () => "sender",
    });

    await handler(
      "!room:example.org",
      createMatrixTextMessageEvent({
        eventId: "$event2",
        body: "hello",
        mentions: { room: true },
      }),
    );

    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "matrix",
        accountId: "ops",
      }),
    );
  });

  it("records thread starter context for inbound thread replies", async () => {
    const { handler, finalizeInboundContext, recordInboundSession } =
      createMatrixHandlerTestHarness({
        client: {
          getEvent: async () =>
            createMatrixTextMessageEvent({
              eventId: "$root",
              sender: "@alice:example.org",
              body: "Root topic",
            }),
        },
        isDirectMessage: false,
        getMemberDisplayName: async (_roomId, userId) =>
          userId === "@alice:example.org" ? "Alice" : "sender",
      });

    await handler(
      "!room:example.org",
      createMatrixTextMessageEvent({
        eventId: "$reply1",
        body: "follow up",
        relatesTo: {
          rel_type: "m.thread",
          event_id: "$root",
          "m.in_reply_to": { event_id: "$root" },
        },
        mentions: { room: true },
      }),
    );

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

  it("routes bound Matrix threads to the target session key", async () => {
    registerSessionBindingAdapter({
      channel: "matrix",
      accountId: "ops",
      listBySession: () => [],
      resolveByConversation: (ref) =>
        ref.conversationId === "$root"
          ? {
              bindingId: "ops:!room:example:$root",
              targetSessionKey: "agent:bound:session-1",
              targetKind: "session",
              conversation: {
                channel: "matrix",
                accountId: "ops",
                conversationId: "$root",
                parentConversationId: "!room:example",
              },
              status: "active",
              boundAt: Date.now(),
              metadata: {
                boundBy: "user-1",
              },
            }
          : null,
      touch: vi.fn(),
    });
    const { handler, recordInboundSession } = createMatrixHandlerTestHarness({
      client: {
        getEvent: async () =>
          createMatrixTextMessageEvent({
            eventId: "$root",
            sender: "@alice:example.org",
            body: "Root topic",
          }),
      },
      isDirectMessage: false,
      finalizeInboundContext: (ctx: unknown) => ctx,
      getMemberDisplayName: async () => "sender",
    });

    await handler(
      "!room:example",
      createMatrixTextMessageEvent({
        eventId: "$reply1",
        body: "follow up",
        relatesTo: {
          rel_type: "m.thread",
          event_id: "$root",
          "m.in_reply_to": { event_id: "$root" },
        },
        mentions: { room: true },
      }),
    );

    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:bound:session-1",
      }),
    );
  });

  it("enqueues system events for reactions on bot-authored messages", async () => {
    const { handler, enqueueSystemEvent, resolveAgentRoute } = createReactionHarness();

    await handler(
      "!room:example.org",
      createMatrixReactionEvent({
        eventId: "$reaction1",
        targetEventId: "$msg1",
        key: "👍",
      }),
    );

    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "matrix",
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

    await handler(
      "!room:example.org",
      createMatrixReactionEvent({
        eventId: "$reaction2",
        targetEventId: "$msg2",
        key: "👀",
      }),
    );

    expect(enqueueSystemEvent).not.toHaveBeenCalled();
    expect(resolveAgentRoute).not.toHaveBeenCalled();
  });

  it("does not create pairing requests for unauthorized dm reactions", async () => {
    const { handler, enqueueSystemEvent, upsertPairingRequest } = createReactionHarness({
      dmPolicy: "pairing",
    });

    await handler(
      "!room:example.org",
      createMatrixReactionEvent({
        eventId: "$reaction3",
        targetEventId: "$msg3",
        key: "🔥",
      }),
    );

    expect(upsertPairingRequest).not.toHaveBeenCalled();
    expect(enqueueSystemEvent).not.toHaveBeenCalled();
  });

  it("honors account-scoped reaction notification overrides", async () => {
    const { handler, enqueueSystemEvent } = createReactionHarness({
      cfg: {
        channels: {
          matrix: {
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

    await handler(
      "!room:example.org",
      createMatrixReactionEvent({
        eventId: "$reaction4",
        targetEventId: "$msg4",
        key: "✅",
      }),
    );

    expect(enqueueSystemEvent).not.toHaveBeenCalled();
  });
});
