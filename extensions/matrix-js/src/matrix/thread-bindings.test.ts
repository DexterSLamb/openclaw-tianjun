import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/matrix-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSessionBindingService,
  __testing,
} from "../../../../src/infra/outbound/session-binding-service.js";
import { setMatrixRuntime } from "../runtime.js";
import {
  createMatrixThreadBindingManager,
  resetMatrixThreadBindingsForTests,
} from "./thread-bindings.js";

const sendMessageMatrixMock = vi.hoisted(() =>
  vi.fn(async (_to: string, _message: string, opts?: { threadId?: string }) => ({
    messageId: opts?.threadId ? "$reply" : "$root",
    roomId: "!room:example",
  })),
);

vi.mock("./send.js", async () => {
  const actual = await vi.importActual<typeof import("./send.js")>("./send.js");
  return {
    ...actual,
    sendMessageMatrix: sendMessageMatrixMock,
  };
});

describe("matrix thread bindings", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "matrix-thread-bindings-"));
    __testing.resetSessionBindingAdaptersForTests();
    resetMatrixThreadBindingsForTests();
    sendMessageMatrixMock.mockClear();
    setMatrixRuntime({
      state: {
        resolveStateDir: () => stateDir,
      },
    } as PluginRuntime);
  });

  it("creates child Matrix thread bindings from a top-level room context", async () => {
    await createMatrixThreadBindingManager({
      accountId: "ops",
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      client: {} as never,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
      maxAgeMs: 0,
      enableSweeper: false,
    });

    const binding = await getSessionBindingService().bind({
      targetSessionKey: "agent:ops:subagent:child",
      targetKind: "subagent",
      conversation: {
        channel: "matrix-js",
        accountId: "ops",
        conversationId: "!room:example",
      },
      placement: "child",
      metadata: {
        introText: "intro root",
      },
    });

    expect(sendMessageMatrixMock).toHaveBeenCalledWith("room:!room:example", "intro root", {
      client: {},
      accountId: "ops",
    });
    expect(binding.conversation).toEqual({
      channel: "matrix-js",
      accountId: "ops",
      conversationId: "$root",
      parentConversationId: "!room:example",
    });
  });

  it("posts intro messages inside existing Matrix threads for current placement", async () => {
    await createMatrixThreadBindingManager({
      accountId: "ops",
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      client: {} as never,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
      maxAgeMs: 0,
      enableSweeper: false,
    });

    const binding = await getSessionBindingService().bind({
      targetSessionKey: "agent:ops:subagent:child",
      targetKind: "subagent",
      conversation: {
        channel: "matrix-js",
        accountId: "ops",
        conversationId: "$thread",
        parentConversationId: "!room:example",
      },
      placement: "current",
      metadata: {
        introText: "intro thread",
      },
    });

    expect(sendMessageMatrixMock).toHaveBeenCalledWith("room:!room:example", "intro thread", {
      client: {},
      accountId: "ops",
      threadId: "$thread",
    });
    expect(
      getSessionBindingService().resolveByConversation({
        channel: "matrix-js",
        accountId: "ops",
        conversationId: "$thread",
        parentConversationId: "!room:example",
      }),
    ).toMatchObject({
      bindingId: binding.bindingId,
      targetSessionKey: "agent:ops:subagent:child",
    });
  });

  it("expires idle bindings via the sweeper", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T12:00:00.000Z"));
    try {
      await createMatrixThreadBindingManager({
        accountId: "ops",
        auth: {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          accessToken: "token",
        },
        client: {} as never,
        idleTimeoutMs: 1_000,
        maxAgeMs: 0,
      });

      await getSessionBindingService().bind({
        targetSessionKey: "agent:ops:subagent:child",
        targetKind: "subagent",
        conversation: {
          channel: "matrix-js",
          accountId: "ops",
          conversationId: "$thread",
          parentConversationId: "!room:example",
        },
        placement: "current",
        metadata: {
          introText: "intro thread",
        },
      });

      sendMessageMatrixMock.mockClear();
      await vi.advanceTimersByTimeAsync(61_000);
      await Promise.resolve();

      expect(
        getSessionBindingService().resolveByConversation({
          channel: "matrix-js",
          accountId: "ops",
          conversationId: "$thread",
          parentConversationId: "!room:example",
        }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends threaded farewell messages when bindings are unbound", async () => {
    await createMatrixThreadBindingManager({
      accountId: "ops",
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      client: {} as never,
      idleTimeoutMs: 1_000,
      maxAgeMs: 0,
      enableSweeper: false,
    });

    const binding = await getSessionBindingService().bind({
      targetSessionKey: "agent:ops:subagent:child",
      targetKind: "subagent",
      conversation: {
        channel: "matrix-js",
        accountId: "ops",
        conversationId: "$thread",
        parentConversationId: "!room:example",
      },
      placement: "current",
      metadata: {
        introText: "intro thread",
      },
    });

    sendMessageMatrixMock.mockClear();
    await getSessionBindingService().unbind({
      bindingId: binding.bindingId,
      reason: "idle-expired",
    });

    expect(sendMessageMatrixMock).toHaveBeenCalledWith(
      "room:!room:example",
      expect.stringContaining("Session ended automatically"),
      expect.objectContaining({
        accountId: "ops",
        threadId: "$thread",
      }),
    );
  });
});
