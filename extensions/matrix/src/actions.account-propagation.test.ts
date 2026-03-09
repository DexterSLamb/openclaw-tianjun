import type { ChannelMessageActionContext } from "openclaw/plugin-sdk/matrix";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "./types.js";

const mocks = vi.hoisted(() => ({
  handleMatrixAction: vi.fn(),
}));

vi.mock("./tool-actions.js", () => ({
  handleMatrixAction: mocks.handleMatrixAction,
}));

const { matrixMessageActions } = await import("./actions.js");

function createContext(
  overrides: Partial<ChannelMessageActionContext>,
): ChannelMessageActionContext {
  return {
    channel: "matrix",
    action: "send",
    cfg: {
      channels: {
        matrix: {
          enabled: true,
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          accessToken: "token",
        },
      },
    } as CoreConfig,
    params: {},
    ...overrides,
  };
}

describe("matrixMessageActions account propagation", () => {
  beforeEach(() => {
    mocks.handleMatrixAction.mockReset().mockResolvedValue({
      ok: true,
      output: "",
      details: { ok: true },
    });
  });

  it("forwards accountId for send actions", async () => {
    await matrixMessageActions.handleAction?.(
      createContext({
        action: "send",
        accountId: "ops",
        params: {
          to: "room:!room:example",
          message: "hello",
        },
      }),
    );

    expect(mocks.handleMatrixAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sendMessage",
        accountId: "ops",
      }),
      expect.any(Object),
    );
  });

  it("forwards accountId for permissions actions", async () => {
    await matrixMessageActions.handleAction?.(
      createContext({
        action: "permissions",
        accountId: "ops",
        params: {
          operation: "verification-list",
        },
      }),
    );

    expect(mocks.handleMatrixAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "verificationList",
        accountId: "ops",
      }),
      expect.any(Object),
    );
  });
});
