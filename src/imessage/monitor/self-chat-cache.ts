import { createHash } from "node:crypto";

export type SelfChatLookup = {
  text?: string;
  createdAt?: number;
};

export type SelfChatCache = {
  remember: (scope: string, lookup: SelfChatLookup) => void;
  has: (scope: string, lookup: SelfChatLookup) => boolean;
};

const SELF_CHAT_TTL_MS = 10_000;
const MAX_SELF_CHAT_CACHE_ENTRIES = 512;
const CLEANUP_MIN_INTERVAL_MS = 1_000;
const DIGEST_TEXT_HEAD_CHARS = 256;
const DIGEST_TEXT_TAIL_CHARS = 256;

function normalizeText(text: string | undefined): string | null {
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  return normalized ? normalized : null;
}

function isUsableTimestamp(createdAt: number | undefined): createdAt is number {
  return typeof createdAt === "number" && Number.isFinite(createdAt);
}

function buildDigestSource(text: string): string {
  if (text.length <= DIGEST_TEXT_HEAD_CHARS + DIGEST_TEXT_TAIL_CHARS) {
    return text;
  }
  return `${text.slice(0, DIGEST_TEXT_HEAD_CHARS)}\u0000${text.length}\u0000${text.slice(-DIGEST_TEXT_TAIL_CHARS)}`;
}

function digestText(text: string): string {
  return createHash("sha256").update(buildDigestSource(text)).digest("hex");
}

class DefaultSelfChatCache implements SelfChatCache {
  private cache = new Map<string, number>();
  private lastCleanupAt = 0;

  private buildKey(scope: string, lookup: SelfChatLookup): string | null {
    const text = normalizeText(lookup.text);
    if (!text || !isUsableTimestamp(lookup.createdAt)) {
      return null;
    }
    return `${scope}:${lookup.createdAt}:${digestText(text)}`;
  }

  remember(scope: string, lookup: SelfChatLookup): void {
    const key = this.buildKey(scope, lookup);
    if (!key) {
      return;
    }
    this.cache.set(key, Date.now());
    this.maybeCleanup();
  }

  has(scope: string, lookup: SelfChatLookup): boolean {
    this.maybeCleanup();
    const key = this.buildKey(scope, lookup);
    if (!key) {
      return false;
    }
    const timestamp = this.cache.get(key);
    return typeof timestamp === "number" && Date.now() - timestamp <= SELF_CHAT_TTL_MS;
  }

  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) {
      return;
    }
    this.lastCleanupAt = now;
    for (const [key, timestamp] of this.cache.entries()) {
      if (now - timestamp > SELF_CHAT_TTL_MS) {
        this.cache.delete(key);
      }
    }
    while (this.cache.size > MAX_SELF_CHAT_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey !== "string") {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }
}

export function createSelfChatCache(): SelfChatCache {
  return new DefaultSelfChatCache();
}
