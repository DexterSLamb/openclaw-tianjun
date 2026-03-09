import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  findMatrixAccountEntry,
  resolveConfiguredMatrixAccountIds,
  resolveMatrixDefaultOrOnlyAccountId,
} from "./matrix-account-selection.js";

describe("matrix account selection", () => {
  it("resolves configured account ids from non-canonical account keys", () => {
    const cfg: OpenClawConfig = {
      channels: {
        matrix: {
          accounts: {
            "Team Ops": { homeserver: "https://matrix.example.org" },
          },
        },
      },
    };

    expect(resolveConfiguredMatrixAccountIds(cfg)).toEqual(["team-ops"]);
    expect(resolveMatrixDefaultOrOnlyAccountId(cfg)).toBe("team-ops");
  });

  it("matches the default account against normalized Matrix account keys", () => {
    const cfg: OpenClawConfig = {
      channels: {
        matrix: {
          defaultAccount: "Team Ops",
          accounts: {
            "Ops Bot": { homeserver: "https://matrix.example.org" },
            "Team Ops": { homeserver: "https://matrix.example.org" },
          },
        },
      },
    };

    expect(resolveMatrixDefaultOrOnlyAccountId(cfg)).toBe("team-ops");
  });

  it("finds the raw Matrix account entry by normalized account id", () => {
    const cfg: OpenClawConfig = {
      channels: {
        matrix: {
          accounts: {
            "Team Ops": {
              homeserver: "https://matrix.example.org",
              userId: "@ops:example.org",
            },
          },
        },
      },
    };

    expect(findMatrixAccountEntry(cfg, "team-ops")).toEqual({
      homeserver: "https://matrix.example.org",
      userId: "@ops:example.org",
    });
  });
});
