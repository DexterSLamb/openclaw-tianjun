import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHost } from "../ui/src/ui/app-chat.ts";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../ui/src/ui/chat/attachment-support.ts";
import { getPinnedMessageSummary } from "../ui/src/ui/chat/pinned-summary.ts";
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
