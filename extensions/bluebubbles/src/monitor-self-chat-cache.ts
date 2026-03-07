import { createHash } from "node:crypto";

type SelfChatLookup = {
  body?: string;
  timestamp?: number;
};

const SELF_CHAT_TTL_MS = 10_000;
const MAX_SELF_CHAT_CACHE_ENTRIES = 512;
const CLEANUP_MIN_INTERVAL_MS = 1_000;
const DIGEST_TEXT_HEAD_CHARS = 256;
const DIGEST_TEXT_TAIL_CHARS = 256;
const cache = new Map<string, number>();
let lastCleanupAt = 0;

function normalizeBody(body: string | undefined): string | null {
  if (!body) {
    return null;
  }
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  return normalized ? normalized : null;
}

function isUsableTimestamp(timestamp: number | undefined): timestamp is number {
  return typeof timestamp === "number" && Number.isFinite(timestamp);
}

function buildDigestSource(text: string): string {
  if (text.length <= DIGEST_TEXT_HEAD_CHARS + DIGEST_TEXT_TAIL_CHARS) {
    return text;
  }
  return `${text.slice(0, DIGEST_TEXT_HEAD_CHARS)}:${text.length}:${text.slice(-DIGEST_TEXT_TAIL_CHARS)}`;
}

function digestText(text: string): string {
  return createHash("sha256").update(buildDigestSource(text)).digest("base64url");
}

function maybeCleanup(now = Date.now()): void {
  if (lastCleanupAt !== 0 && now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) {
    return;
  }
  lastCleanupAt = now;
  for (const [key, seenAt] of cache.entries()) {
    if (now - seenAt > SELF_CHAT_TTL_MS) {
      cache.delete(key);
    }
  }
  while (cache.size > MAX_SELF_CHAT_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
}

function buildKey(scope: string, lookup: SelfChatLookup): string | null {
  const body = normalizeBody(lookup.body);
  if (!body || !isUsableTimestamp(lookup.timestamp)) {
    return null;
  }
  return `${scope}:${lookup.timestamp}:${digestText(body)}`;
}

export function rememberBlueBubblesSelfChatCopy(scope: string, lookup: SelfChatLookup): void {
  maybeCleanup();
  const key = buildKey(scope, lookup);
  if (!key) {
    return;
  }
  cache.set(key, Date.now());
  maybeCleanup();
}

export function hasBlueBubblesSelfChatCopy(scope: string, lookup: SelfChatLookup): boolean {
  maybeCleanup();
  const key = buildKey(scope, lookup);
  if (!key) {
    return false;
  }
  const seenAt = cache.get(key);
  return typeof seenAt === "number" && Date.now() - seenAt <= SELF_CHAT_TTL_MS;
}

export function resetBlueBubblesSelfChatCache(): void {
  cache.clear();
  lastCleanupAt = 0;
}
