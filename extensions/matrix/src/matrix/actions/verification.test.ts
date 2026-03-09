import { beforeEach, describe, expect, it, vi } from "vitest";

const withStartedActionClientMock = vi.fn();
const loadConfigMock = vi.fn(() => ({
  channels: {
    matrix: {},
  },
}));

vi.mock("../../runtime.js", () => ({
  getMatrixRuntime: () => ({
    config: {
      loadConfig: loadConfigMock,
    },
  }),
}));

vi.mock("./client.js", () => ({
  withStartedActionClient: (...args: unknown[]) => withStartedActionClientMock(...args),
}));

let listMatrixVerifications: typeof import("./verification.js").listMatrixVerifications;

describe("matrix verification actions", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue({
      channels: {
        matrix: {},
      },
    });
    ({ listMatrixVerifications } = await import("./verification.js"));
  });

  it("points encryption guidance at the selected Matrix account", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        matrix: {
          accounts: {
            ops: {
              encryption: false,
            },
          },
        },
      },
    });
    withStartedActionClientMock.mockImplementation(async (_opts, run) => {
      return await run({ crypto: null });
    });

    await expect(listMatrixVerifications({ accountId: "ops" })).rejects.toThrow(
      "Matrix encryption is not available (enable channels.matrix.accounts.ops.encryption=true)",
    );
  });

  it("uses the resolved default Matrix account when accountId is omitted", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        matrix: {
          defaultAccount: "ops",
          accounts: {
            ops: {
              encryption: false,
            },
          },
        },
      },
    });
    withStartedActionClientMock.mockImplementation(async (_opts, run) => {
      return await run({ crypto: null });
    });

    await expect(listMatrixVerifications()).rejects.toThrow(
      "Matrix encryption is not available (enable channels.matrix.accounts.ops.encryption=true)",
    );
  });
});
