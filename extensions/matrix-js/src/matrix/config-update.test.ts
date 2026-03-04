import { describe, expect, it } from "vitest";
import type { CoreConfig } from "../types.js";
import { updateMatrixAccountConfig } from "./config-update.js";

describe("updateMatrixAccountConfig", () => {
  it("supports explicit null clears and boolean false values", () => {
    const cfg = {
      channels: {
        "matrix-js": {
          accounts: {
            default: {
              homeserver: "https://matrix.example.org",
              userId: "@bot:example.org",
              accessToken: "old-token",
              password: "old-password",
              encryption: true,
            },
          },
        },
      },
    } as CoreConfig;

    const updated = updateMatrixAccountConfig(cfg, "default", {
      accessToken: "new-token",
      password: null,
      userId: null,
      encryption: false,
    });

    expect(updated.channels?.["matrix-js"]?.accounts?.default).toMatchObject({
      accessToken: "new-token",
      encryption: false,
    });
    expect(updated.channels?.["matrix-js"]?.accounts?.default?.password).toBeUndefined();
    expect(updated.channels?.["matrix-js"]?.accounts?.default?.userId).toBeUndefined();
  });

  it("normalizes account id and defaults account enabled=true", () => {
    const updated = updateMatrixAccountConfig({} as CoreConfig, "Main Bot", {
      name: "Main Bot",
      homeserver: "https://matrix.example.org",
    });

    expect(updated.channels?.["matrix-js"]?.accounts?.["main-bot"]).toMatchObject({
      name: "Main Bot",
      homeserver: "https://matrix.example.org",
      enabled: true,
    });
  });
});
