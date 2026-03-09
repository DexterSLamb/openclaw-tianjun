import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/matrix";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSessionBindingService,
  __testing,
} from "../../../../src/infra/outbound/session-binding-service.js";
import { setMatrixRuntime } from "../runtime.js";
import { resolveMatrixStoragePaths } from "./client/storage.js";
import {
  createMatrixThreadBindingManager,
  resetMatrixThreadBindingsForTests,
  setMatrixThreadBindingIdleTimeoutBySessionKey,
  setMatrixThreadBindingMaxAgeBySessionKey,
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
  const auth = {
    accountId: "ops",
    homeserver: "https://matrix.example.org",
    userId: "@bot:example.org",
    accessToken: "token",
  } as const;

  function resolveBindingsFilePath() {
    return path.join(
      resolveMatrixStoragePaths({
        ...auth,
        env: process.env,
      }).rootDir,
      "thread-bindings.json",
    );
  }

  async function readPersistedLastActivityAt(bindingsPath: string) {
    const raw = await fs.readFile(bindingsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      bindings?: Array<{ lastActivityAt?: number }>;
    };
    return parsed.bindings?.[0]?.lastActivityAt;
  }

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
      auth,
      client: {} as never,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
      maxAgeMs: 0,
      enableSweeper: false,
    });

    const binding = await getSessionBindingService().bind({
      targetSessionKey: "agent:ops:subagent:child",
      targetKind: "subagent",
      conversation: {
        channel: "matrix",
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
      channel: "matrix",
      accountId: "ops",
      conversationId: "$root",
      parentConversationId: "!room:example",
    });
  });

  it("posts intro messages inside existing Matrix threads for current placement", async () => {
    await createMatrixThreadBindingManager({
      accountId: "ops",
      auth,
      client: {} as never,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
      maxAgeMs: 0,
      enableSweeper: false,
    });

    const binding = await getSessionBindingService().bind({
      targetSessionKey: "agent:ops:subagent:child",
      targetKind: "subagent",
      conversation: {
        channel: "matrix",
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
        channel: "matrix",
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
        auth,
        client: {} as never,
        idleTimeoutMs: 1_000,
        maxAgeMs: 0,
      });

      await getSessionBindingService().bind({
        targetSessionKey: "agent:ops:subagent:child",
        targetKind: "subagent",
        conversation: {
          channel: "matrix",
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
          channel: "matrix",
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
      auth,
      client: {} as never,
      idleTimeoutMs: 1_000,
      maxAgeMs: 0,
      enableSweeper: false,
    });

    const binding = await getSessionBindingService().bind({
      targetSessionKey: "agent:ops:subagent:child",
      targetKind: "subagent",
      conversation: {
        channel: "matrix",
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

  it("updates lifecycle windows by session key and refreshes activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    try {
      const manager = await createMatrixThreadBindingManager({
        accountId: "ops",
        auth,
        client: {} as never,
        idleTimeoutMs: 24 * 60 * 60 * 1000,
        maxAgeMs: 0,
        enableSweeper: false,
      });

      await getSessionBindingService().bind({
        targetSessionKey: "agent:ops:subagent:child",
        targetKind: "subagent",
        conversation: {
          channel: "matrix",
          accountId: "ops",
          conversationId: "$thread",
          parentConversationId: "!room:example",
        },
        placement: "current",
      });
      const original = manager.listBySessionKey("agent:ops:subagent:child")[0];
      expect(original).toBeDefined();

      const idleUpdated = setMatrixThreadBindingIdleTimeoutBySessionKey({
        accountId: "ops",
        targetSessionKey: "agent:ops:subagent:child",
        idleTimeoutMs: 2 * 60 * 60 * 1000,
      });
      vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));
      const maxAgeUpdated = setMatrixThreadBindingMaxAgeBySessionKey({
        accountId: "ops",
        targetSessionKey: "agent:ops:subagent:child",
        maxAgeMs: 6 * 60 * 60 * 1000,
      });

      expect(idleUpdated).toHaveLength(1);
      expect(idleUpdated[0]?.metadata?.idleTimeoutMs).toBe(2 * 60 * 60 * 1000);
      expect(maxAgeUpdated).toHaveLength(1);
      expect(maxAgeUpdated[0]?.metadata?.maxAgeMs).toBe(6 * 60 * 60 * 1000);
      expect(maxAgeUpdated[0]?.boundAt).toBe(original?.boundAt);
      expect(maxAgeUpdated[0]?.metadata?.lastActivityAt).toBe(
        Date.parse("2026-03-06T12:00:00.000Z"),
      );
      expect(manager.listBySessionKey("agent:ops:subagent:child")[0]?.maxAgeMs).toBe(
        6 * 60 * 60 * 1000,
      );
      expect(manager.listBySessionKey("agent:ops:subagent:child")[0]?.lastActivityAt).toBe(
        Date.parse("2026-03-06T12:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists the latest touched activity only after the debounce window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    try {
      await createMatrixThreadBindingManager({
        accountId: "ops",
        auth,
        client: {} as never,
        idleTimeoutMs: 24 * 60 * 60 * 1000,
        maxAgeMs: 0,
        enableSweeper: false,
      });
      const binding = await getSessionBindingService().bind({
        targetSessionKey: "agent:ops:subagent:child",
        targetKind: "subagent",
        conversation: {
          channel: "matrix",
          accountId: "ops",
          conversationId: "$thread",
          parentConversationId: "!room:example",
        },
        placement: "current",
      });

      const bindingsPath = resolveBindingsFilePath();
      const originalLastActivityAt = await readPersistedLastActivityAt(bindingsPath);
      const firstTouchedAt = Date.parse("2026-03-06T10:05:00.000Z");
      const secondTouchedAt = Date.parse("2026-03-06T10:10:00.000Z");

      getSessionBindingService().touch(binding.bindingId, firstTouchedAt);
      getSessionBindingService().touch(binding.bindingId, secondTouchedAt);

      await vi.advanceTimersByTimeAsync(29_000);
      expect(await readPersistedLastActivityAt(bindingsPath)).toBe(originalLastActivityAt);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(async () => {
        expect(await readPersistedLastActivityAt(bindingsPath)).toBe(secondTouchedAt);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes pending touch persistence on stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    try {
      const manager = await createMatrixThreadBindingManager({
        accountId: "ops",
        auth,
        client: {} as never,
        idleTimeoutMs: 24 * 60 * 60 * 1000,
        maxAgeMs: 0,
        enableSweeper: false,
      });
      const binding = await getSessionBindingService().bind({
        targetSessionKey: "agent:ops:subagent:child",
        targetKind: "subagent",
        conversation: {
          channel: "matrix",
          accountId: "ops",
          conversationId: "$thread",
          parentConversationId: "!room:example",
        },
        placement: "current",
      });
      const touchedAt = Date.parse("2026-03-06T12:00:00.000Z");
      getSessionBindingService().touch(binding.bindingId, touchedAt);

      manager.stop();
      vi.useRealTimers();

      const bindingsPath = resolveBindingsFilePath();
      await vi.waitFor(async () => {
        expect(await readPersistedLastActivityAt(bindingsPath)).toBe(touchedAt);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
