import { describe, expect, it, vi } from "vitest";
import { createSelfChatCache } from "./self-chat-cache.js";

describe("createSelfChatCache", () => {
  it("matches repeated lookups for the same scope, timestamp, and text", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));

    const cache = createSelfChatCache();
    cache.remember("default:imessage:+15555550123", {
      text: "  hello\r\nworld  ",
      createdAt: 123,
    });

    expect(
      cache.has("default:imessage:+15555550123", {
        text: "hello\nworld",
        createdAt: 123,
      }),
    ).toBe(true);
  });

  it("expires entries after the ttl window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));

    const cache = createSelfChatCache();
    cache.remember("scope", { text: "hello", createdAt: 123 });

    vi.advanceTimersByTime(11_001);

    expect(cache.has("scope", { text: "hello", createdAt: 123 })).toBe(false);
  });

  it("evicts older entries when the cache exceeds its cap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));

    const cache = createSelfChatCache();
    for (let i = 0; i < 513; i += 1) {
      cache.remember("scope", {
        text: `message-${i}`,
        createdAt: i,
      });
      vi.advanceTimersByTime(1_001);
    }

    expect(cache.has("scope", { text: "message-0", createdAt: 0 })).toBe(false);
    expect(cache.has("scope", { text: "message-512", createdAt: 512 })).toBe(true);
  });

  it("handles long texts without requiring the full body in the cache key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));

    const cache = createSelfChatCache();
    const longText = `${"a".repeat(800)}middle${"b".repeat(800)}`;

    cache.remember("scope", { text: longText, createdAt: 123 });

    expect(cache.has("scope", { text: longText, createdAt: 123 })).toBe(true);
  });
});
