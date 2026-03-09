import { describe, expect, it } from "vitest";
import type { CoreConfig } from "../types.js";
import { updateMatrixAccountConfig } from "./config-update.js";

describe("updateMatrixAccountConfig", () => {
  it("supports explicit null clears and boolean false values", () => {
    const cfg = {
      channels: {
        matrix: {
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

    expect(updated.channels?.["matrix"]?.accounts?.default).toMatchObject({
      accessToken: "new-token",
      encryption: false,
    });
    expect(updated.channels?.["matrix"]?.accounts?.default?.password).toBeUndefined();
    expect(updated.channels?.["matrix"]?.accounts?.default?.userId).toBeUndefined();
  });

  it("normalizes account id and defaults account enabled=true", () => {
    const updated = updateMatrixAccountConfig({} as CoreConfig, "Main Bot", {
      name: "Main Bot",
      homeserver: "https://matrix.example.org",
    });

    expect(updated.channels?.["matrix"]?.accounts?.["main-bot"]).toMatchObject({
      name: "Main Bot",
      homeserver: "https://matrix.example.org",
      enabled: true,
    });
  });

  it("updates nested access config for named accounts without touching top-level defaults", () => {
    const cfg = {
      channels: {
        matrix: {
          dm: {
            policy: "pairing",
          },
          groups: {
            "!default:example.org": { allow: true },
          },
          accounts: {
            ops: {
              homeserver: "https://matrix.ops.example.org",
              accessToken: "ops-token",
              dm: {
                enabled: true,
                policy: "pairing",
              },
            },
          },
        },
      },
    } as CoreConfig;

    const updated = updateMatrixAccountConfig(cfg, "ops", {
      dm: {
        policy: "allowlist",
        allowFrom: ["@alice:example.org"],
      },
      groupPolicy: "allowlist",
      groups: {
        "!ops-room:example.org": { allow: true },
      },
      rooms: null,
    });

    expect(updated.channels?.["matrix"]?.dm?.policy).toBe("pairing");
    expect(updated.channels?.["matrix"]?.groups).toEqual({
      "!default:example.org": { allow: true },
    });
    expect(updated.channels?.["matrix"]?.accounts?.ops).toMatchObject({
      dm: {
        enabled: true,
        policy: "allowlist",
        allowFrom: ["@alice:example.org"],
      },
      groupPolicy: "allowlist",
      groups: {
        "!ops-room:example.org": { allow: true },
      },
    });
    expect(updated.channels?.["matrix"]?.accounts?.ops?.rooms).toBeUndefined();
  });
});
