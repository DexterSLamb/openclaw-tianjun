import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHost } from "../ui/src/ui/app-chat.ts";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../ui/src/ui/chat/attachment-support.ts";
import { DeletedMessages } from "../ui/src/ui/chat/deleted-messages.ts";
import { buildChatMarkdown } from "../ui/src/ui/chat/export.ts";
import { getPinnedMessageSummary } from "../ui/src/ui/chat/pinned-summary.ts";
import { messageMatchesSearchQuery } from "../ui/src/ui/chat/search-match.ts";
import {
  MAX_CACHED_CHAT_SESSIONS,
  getOrCreateSessionCacheValue,
} from "../ui/src/ui/chat/session-cache.ts";
import type { GatewayBrowserClient } from "../ui/src/ui/gateway.ts";

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function createHost(overrides: Partial<ChatHost> = {}): ChatHost & Record<string, unknown> {
  return {
    client: {
      request: vi.fn(),
    } as unknown as GatewayBrowserClient,
    chatMessages: [{ role: "assistant", content: "existing", timestamp: 1 }],
    chatStream: "streaming",
    connected: true,
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: "run-1",
    chatSending: false,
    lastError: null,
    sessionKey: "main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    refreshSessionsAfterChat: new Set<string>(),
    updateComplete: Promise.resolve(),
    querySelector: () => null,
    style: { setProperty: () => undefined } as CSSStyleDeclaration,
    chatScrollFrame: null,
    chatScrollTimeout: null,
    chatHasAutoScrolled: false,
    chatUserNearBottom: true,
    chatNewMessagesBelow: false,
    logsScrollFrame: null,
    logsAtBottom: true,
    topbarObserver: null,
    ...overrides,
  };
}

function createSettingsHost() {
  return {
    settings: {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
    },
    theme: "claw",
    themeMode: "system",
    themeResolved: "dark",
    applySessionKey: "main",
    sessionKey: "main",
    tab: "chat",
    connected: false,
    chatHasAutoScrolled: false,
    logsAtBottom: false,
    eventLog: [],
    eventLogBuffer: [],
    basePath: "",
    systemThemeCleanup: null,
  } as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetModules();
  const { window, document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("localStorage", createStorageMock());
  vi.stubGlobal("sessionStorage", createStorageMock());
  vi.stubGlobal("window", window as unknown as Window & typeof globalThis);
  vi.stubGlobal("document", document as unknown as Document);
  vi.stubGlobal("customElements", window.customElements);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false }),
    configurable: true,
  });
  vi.stubGlobal("requestAnimationFrame", ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", (() => undefined) as typeof cancelAnimationFrame);
  vi.stubGlobal("getComputedStyle", (() => ({ overflowY: "auto" })) as typeof getComputedStyle);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chat regressions", () => {
  it("keeps the picker image-only", () => {
    expect(CHAT_ATTACHMENT_ACCEPT).toBe("image/*");
    expect(isSupportedChatAttachmentMimeType("image/png")).toBe(true);
    expect(isSupportedChatAttachmentMimeType("application/pdf")).toBe(false);
    expect(isSupportedChatAttachmentMimeType("text/plain")).toBe(false);
  });

  it("summarizes pinned messages from structured content blocks", () => {
    expect(
      getPinnedMessageSummary({
        role: "assistant",
        content: [{ type: "text", text: "hello from structured content" }],
      }),
    ).toBe("hello from structured content");
  });

  it("degrades gracefully when deleted-message persistence cannot write", () => {
    const failingStorage = createStorageMock();
    vi.spyOn(failingStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.stubGlobal("localStorage", failingStorage);

    const deleted = new DeletedMessages("main");
    expect(() => deleted.delete("msg-1")).not.toThrow();
    expect(() => deleted.restore("msg-1")).not.toThrow();
    expect(() => deleted.clear()).not.toThrow();
  });

  it("exports structured message content instead of blank blocks", () => {
    const markdown = buildChatMarkdown(
      [
        {
          role: "user",
          content: [{ type: "text", text: "hello there" }],
          timestamp: Date.UTC(2026, 2, 10, 12, 0, 0),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "general kenobi" }],
          timestamp: Date.UTC(2026, 2, 10, 12, 0, 5),
        },
      ],
      "OpenClaw",
    );

    expect(markdown).toContain("hello there");
    expect(markdown).toContain("general kenobi");
  });

  it("matches chat search against extracted structured message text", () => {
    expect(
      messageMatchesSearchQuery(
        {
          role: "assistant",
          content: [{ type: "text", text: "Structured search target" }],
        },
        "search target",
      ),
    ).toBe(true);
    expect(
      messageMatchesSearchQuery(
        {
          role: "assistant",
          content: [{ type: "text", text: "Structured search target" }],
        },
        "missing",
      ),
    ).toBe(false);
  });

  it("bounds cached per-session chat state", () => {
    const cache = new Map<string, number>();
    for (let i = 0; i < MAX_CACHED_CHAT_SESSIONS; i++) {
      getOrCreateSessionCacheValue(cache, `session-${i}`, () => i);
    }

    expect(cache.size).toBe(MAX_CACHED_CHAT_SESSIONS);
    expect(getOrCreateSessionCacheValue(cache, "session-0", () => -1)).toBe(0);

    getOrCreateSessionCacheValue(cache, `session-${MAX_CACHED_CHAT_SESSIONS}`, () => 99);

    expect(cache.size).toBe(MAX_CACHED_CHAT_SESSIONS);
    expect(cache.has("session-0")).toBe(true);
    expect(cache.has("session-1")).toBe(false);
  });

  it("keeps the command palette in sync with slash commands", async () => {
    const { getPaletteItems } = await import("../ui/src/ui/views/command-palette.ts");
    const labels = getPaletteItems().map((item) => item.label);

    expect(labels).toContain("/agents");
    expect(labels).toContain("/clear");
    expect(labels).toContain("/kill");
    expect(labels).toContain("/skill");
    expect(labels).toContain("/steer");
  });

  it("falls back to addListener/removeListener for system theme changes", async () => {
    const { attachThemeListener, detachThemeListener } =
      await import("../ui/src/ui/app-settings.ts");
    const host = createSettingsHost();
    const addListener = vi.fn();
    const removeListener = vi.fn();

    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addListener,
        removeListener,
      })),
    );

    attachThemeListener(host);
    expect(addListener).toHaveBeenCalledTimes(1);

    detachThemeListener(host);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("queues local slash commands that would mutate session state during an active run", async () => {
    const { handleSendChat } = await import("../ui/src/ui/app-chat.ts");
    const request = vi.fn();
    const host = createHost({
      client: { request } as unknown as GatewayBrowserClient,
      chatMessage: "/new",
      chatRunId: "run-1",
      chatSending: false,
    });

    await handleSendChat(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("");
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("/new");
    expect(host.chatQueue[0]?.refreshSessions).toBe(true);
  });

  it("resets persisted history for /clear", async () => {
    const { handleSendChat } = await import("../ui/src/ui/app-chat.ts");
    const request = vi.fn(async (method: string, payload?: unknown) => {
      if (method === "sessions.reset") {
        expect(payload).toEqual({ key: "main" });
        return { ok: true };
      }
      if (method === "chat.history") {
        expect(payload).toEqual({ sessionKey: "main", limit: 200 });
        return { messages: [], thinkingLevel: null };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const host = createHost({
      client: { request } as unknown as GatewayBrowserClient,
      chatMessage: "/clear",
      chatRunId: null,
    });

    await handleSendChat(host);

    expect(request).toHaveBeenNthCalledWith(1, "sessions.reset", { key: "main" });
    expect(request).toHaveBeenNthCalledWith(2, "chat.history", {
      sessionKey: "main",
      limit: 200,
    });
    expect(host.chatMessage).toBe("");
    expect(host.chatMessages).toEqual([]);
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
  });
});
