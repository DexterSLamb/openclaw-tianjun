import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setMatrixRuntime } from "../src/runtime.js";

type EnvMap = Record<string, string>;

function loadEnvFile(filePath: string): EnvMap {
  const out: EnvMap = {};
  if (!fs.existsSync(filePath)) {
    return out;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function normalizeHomeserver(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function chunkText(text: string, limit: number): string[] {
  if (!text) {
    return [];
  }
  if (text.length <= limit) {
    return [text];
  }
  const out: string[] = [];
  for (let i = 0; i < text.length; i += limit) {
    out.push(text.slice(i, i + limit));
  }
  return out;
}

export type LiveHarnessConfig = {
  homeserver: string;
  userId: string;
  password: string;
};

export function resolveLiveHarnessConfig(): LiveHarnessConfig {
  const envFromFile = loadEnvFile(path.join(os.homedir(), ".openclaw", ".env"));
  const homeserver = normalizeHomeserver(
    process.env.MATRIX_HOMESERVER ?? envFromFile.MATRIX_HOMESERVER ?? "",
  );
  const userId = process.env.MATRIX_USER_ID ?? envFromFile.MATRIX_USER_ID ?? "";
  const password = process.env.MATRIX_PASSWORD ?? envFromFile.MATRIX_PASSWORD ?? "";

  if (!homeserver || !userId || !password) {
    throw new Error("Missing MATRIX_HOMESERVER / MATRIX_USER_ID / MATRIX_PASSWORD");
  }

  return {
    homeserver,
    userId,
    password,
  };
}

export function installLiveHarnessRuntime(cfg: LiveHarnessConfig): {
  channels: {
    "matrix-js": {
      homeserver: string;
      userId: string;
      password: string;
      encryption: false;
    };
  };
} {
  const pluginCfg = {
    channels: {
      "matrix-js": {
        homeserver: cfg.homeserver,
        userId: cfg.userId,
        password: cfg.password,
        encryption: false as const,
      },
    },
  };

  setMatrixRuntime({
    config: {
      loadConfig: () => pluginCfg,
    },
    state: {
      resolveStateDir: () => path.join(os.homedir(), ".openclaw", "matrix-js-live-harness-state"),
    },
    channel: {
      text: {
        resolveMarkdownTableMode: () => "off",
        convertMarkdownTables: (text: string) => text,
        resolveTextChunkLimit: () => 4000,
        resolveChunkMode: () => "off",
        chunkMarkdownTextWithMode: (text: string, limit: number) => chunkText(text, limit),
      },
    },
    media: {
      mediaKindFromMime: (mime: string) => {
        const value = (mime || "").toLowerCase();
        if (value.startsWith("image/")) {
          return "image";
        }
        if (value.startsWith("audio/")) {
          return "audio";
        }
        if (value.startsWith("video/")) {
          return "video";
        }
        return "document";
      },
      isVoiceCompatibleAudio: () => false,
      loadWebMedia: async () => ({
        buffer: Buffer.from("matrix-js harness media payload\n", "utf8"),
        contentType: "text/plain",
        fileName: "matrix-js-harness.txt",
        kind: "document" as const,
      }),
    },
  } as never);

  return pluginCfg;
}
