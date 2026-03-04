import type { PluginRuntime } from "openclaw/plugin-sdk/matrix-js";
import { beforeEach, describe, expect, it } from "vitest";
import { matrixMessageActions } from "./actions.js";
import { setMatrixRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

const runtimeStub = {
  config: {
    loadConfig: () => ({}),
  },
  media: {
    loadWebMedia: async () => {
      throw new Error("not used");
    },
    mediaKindFromMime: () => "image",
    isVoiceCompatibleAudio: () => false,
    getImageMetadata: async () => null,
    resizeToJpeg: async () => Buffer.from(""),
  },
  state: {
    resolveStateDir: () => "/tmp/openclaw-matrix-js-test",
  },
  channel: {
    text: {
      resolveTextChunkLimit: () => 4000,
      resolveChunkMode: () => "length",
      chunkMarkdownText: (text: string) => (text ? [text] : []),
      chunkMarkdownTextWithMode: (text: string) => (text ? [text] : []),
      resolveMarkdownTableMode: () => "code",
      convertMarkdownTables: (text: string) => text,
    },
  },
} as unknown as PluginRuntime;

function createConfiguredMatrixJsConfig(): CoreConfig {
  return {
    channels: {
      "matrix-js": {
        enabled: true,
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    },
  } as CoreConfig;
}

describe("matrixMessageActions", () => {
  beforeEach(() => {
    setMatrixRuntime(runtimeStub);
  });

  it("exposes poll create but only handles poll votes inside the plugin", () => {
    const listActions = matrixMessageActions.listActions;
    const supportsAction = matrixMessageActions.supportsAction;

    expect(listActions).toBeTypeOf("function");
    expect(supportsAction).toBeTypeOf("function");

    const actions = listActions!({
      cfg: createConfiguredMatrixJsConfig(),
    } as never);

    expect(actions).toContain("poll");
    expect(actions).toContain("poll-vote");
    expect(supportsAction!({ action: "poll" } as never)).toBe(false);
    expect(supportsAction!({ action: "poll-vote" } as never)).toBe(true);
  });
});
