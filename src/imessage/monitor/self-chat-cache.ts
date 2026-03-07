export type SelfChatLookup = {
  text?: string;
  createdAt?: number;
};

export type SelfChatCache = {
  remember: (scope: string, lookup: SelfChatLookup) => void;
  has: (scope: string, lookup: SelfChatLookup) => boolean;
};

const SELF_CHAT_TTL_MS = 10_000;

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

class DefaultSelfChatCache implements SelfChatCache {
  private cache = new Map<string, number>();

  remember(scope: string, lookup: SelfChatLookup): void {
    const text = normalizeText(lookup.text);
    if (!text || !isUsableTimestamp(lookup.createdAt)) {
      return;
    }
    this.cache.set(`${scope}:${lookup.createdAt}:${text}`, Date.now());
    this.cleanup();
  }

  has(scope: string, lookup: SelfChatLookup): boolean {
    this.cleanup();
    const text = normalizeText(lookup.text);
    if (!text || !isUsableTimestamp(lookup.createdAt)) {
      return false;
    }
    const timestamp = this.cache.get(`${scope}:${lookup.createdAt}:${text}`);
    return typeof timestamp === "number" && Date.now() - timestamp <= SELF_CHAT_TTL_MS;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.cache.entries()) {
      if (now - timestamp > SELF_CHAT_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }
}

export function createSelfChatCache(): SelfChatCache {
  return new DefaultSelfChatCache();
}
