import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasBlueBubblesSelfChatCopy,
  rememberBlueBubblesSelfChatCopy,
  resetBlueBubblesSelfChatCache,
} from "./monitor-self-chat-cache.js";

describe("BlueBubbles self-chat cache", () => {
  afterEach(() => {
    resetBlueBubblesSelfChatCache();
    vi.useRealTimers();
  });

  it("matches repeated lookups for the same scope, timestamp, and text", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));

    rememberBlueBubblesSelfChatCopy("scope", {
      body: "  hello\r\nworld  ",
      timestamp: 123,
    });

    expect(
      hasBlueBubblesSelfChatCopy("scope", {
        body: "hello\nworld",
        timestamp: 123,
      }),
    ).toBe(true);
  });

  it("expires entries after the ttl window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));

    rememberBlueBubblesSelfChatCopy("scope", {
      body: "hello",
      timestamp: 123,
    });

    vi.advanceTimersByTime(11_001);

    expect(
      hasBlueBubblesSelfChatCopy("scope", {
        body: "hello",
        timestamp: 123,
      }),
    ).toBe(false);
  });

  it("evicts older entries when the cache exceeds its cap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));

    for (let i = 0; i < 513; i += 1) {
      rememberBlueBubblesSelfChatCopy("scope", {
        body: `message-${i}`,
        timestamp: i,
      });
      vi.advanceTimersByTime(1_001);
    }

    expect(
      hasBlueBubblesSelfChatCopy("scope", {
        body: "message-0",
        timestamp: 0,
      }),
    ).toBe(false);
    expect(
      hasBlueBubblesSelfChatCopy("scope", {
        body: "message-512",
        timestamp: 512,
      }),
    ).toBe(true);
  });
});
