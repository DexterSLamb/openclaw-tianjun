import type { RuntimeEnv, RuntimeLogger } from "openclaw/plugin-sdk/matrix";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setMatrixRuntime } from "../../runtime.js";
import type { MatrixClient } from "../sdk.js";
import { createMatrixRoomMessageHandler } from "./handler.js";
import { EventType, type MatrixRawEvent } from "./types.js";

describe("createMatrixRoomMessageHandler inbound body formatting", () => {
  beforeEach(() => {
    setMatrixRuntime({
      channel: {
        mentions: {
          matchesMentionPatterns: () => false,
        },
        media: {
          saveMediaBuffer: vi.fn(),
        },
      },
      config: {
        loadConfig: () => ({}),
      },
      state: {
        resolveStateDir: () => "/tmp",
      },
    } as never);
  });

  it("records thread metadata for group thread messages", async () => {
    const recordInboundSession = vi.fn(async () => {});
    const finalizeInboundContext = vi.fn((ctx) => ctx);

    const handler = createMatrixRoomMessageHandler({
      client: {
        getUserId: async () => "@bot:example.org",
        getEvent: async () => ({
          event_id: "$thread-root",
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
              channel: "matrix",
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
      } as RuntimeEnv,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      } as RuntimeLogger,
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
          event_id: "$thread-root",
          "m.in_reply_to": { event_id: "$thread-root" },
        },
        "m.mentions": { room: true },
      },
    } as MatrixRawEvent);

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageThreadId: "$thread-root",
        ThreadStarterBody: "Matrix thread root $thread-root from Alice:\nRoot topic",
      }),
    );
    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:ops:main",
      }),
    );
  });

  it("records formatted poll results for inbound poll response events", async () => {
    const recordInboundSession = vi.fn(async () => {});
    const finalizeInboundContext = vi.fn((ctx) => ctx);

    const handler = createMatrixRoomMessageHandler({
      client: {
        getUserId: async () => "@bot:example.org",
        getEvent: async () => ({
          event_id: "$poll",
          sender: "@bot:example.org",
          type: "m.poll.start",
          origin_server_ts: 1,
          content: {
            "m.poll.start": {
              question: { "m.text": "Lunch?" },
              kind: "m.poll.disclosed",
              max_selections: 1,
              answers: [
                { id: "a1", "m.text": "Pizza" },
                { id: "a2", "m.text": "Sushi" },
              ],
            },
          },
        }),
        getRelations: async () => ({
          events: [
            {
              type: "m.poll.response",
              event_id: "$vote1",
              sender: "@user:example.org",
              origin_server_ts: 2,
              content: {
                "m.poll.response": { answers: ["a1"] },
                "m.relates_to": { rel_type: "m.reference", event_id: "$poll" },
              },
            },
          ],
          nextBatch: null,
          prevBatch: null,
        }),
      } as unknown as MatrixClient,
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
              channel: "matrix",
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
      } as RuntimeEnv,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      } as RuntimeLogger,
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
      getMemberDisplayName: async (_roomId, userId) =>
        userId === "@bot:example.org" ? "Bot" : "sender",
    });

    await handler("!room:example.org", {
      type: "m.poll.response",
      sender: "@user:example.org",
      event_id: "$vote1",
      origin_server_ts: 2,
      content: {
        "m.poll.response": { answers: ["a1"] },
        "m.relates_to": { rel_type: "m.reference", event_id: "$poll" },
      },
    } as MatrixRawEvent);

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        RawBody: expect.stringMatching(/1\. Pizza \(1 vote\)[\s\S]*Total voters: 1/),
      }),
    );
    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:ops:main",
      }),
    );
  });
});
