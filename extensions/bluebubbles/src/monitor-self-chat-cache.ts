type SelfChatLookup = {
  body?: string;
  timestamp?: number;
};

const SELF_CHAT_TTL_MS = 10_000;
const cache = new Map<string, number>();

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

function cleanup(now = Date.now()): void {
  for (const [key, seenAt] of cache.entries()) {
    if (now - seenAt > SELF_CHAT_TTL_MS) {
      cache.delete(key);
    }
  }
}

function buildKey(scope: string, lookup: SelfChatLookup): string | null {
  const body = normalizeBody(lookup.body);
  if (!body || !isUsableTimestamp(lookup.timestamp)) {
    return null;
  }
  return `${scope}:${lookup.timestamp}:${body}`;
}

export function rememberBlueBubblesSelfChatCopy(scope: string, lookup: SelfChatLookup): void {
  cleanup();
  const key = buildKey(scope, lookup);
  if (!key) {
    return;
  }
  cache.set(key, Date.now());
}

export function hasBlueBubblesSelfChatCopy(scope: string, lookup: SelfChatLookup): boolean {
  cleanup();
  const key = buildKey(scope, lookup);
  if (!key) {
    return false;
  }
  const seenAt = cache.get(key);
  return typeof seenAt === "number" && Date.now() - seenAt <= SELF_CHAT_TTL_MS;
}

export function resetBlueBubblesSelfChatCache(): void {
  cache.clear();
}
