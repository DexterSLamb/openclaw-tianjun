import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "../sdk.js";

const getActiveMatrixClientMock = vi.fn();
const createMatrixClientMock = vi.fn();
const isBunRuntimeMock = vi.fn(() => false);
const resolveMatrixAuthMock = vi.fn();
const resolveMatrixAuthContextMock = vi.fn();
const getMatrixRuntimeMock = vi.fn();

vi.mock("../active-client.js", () => ({
  getActiveMatrixClient: (...args: unknown[]) => getActiveMatrixClientMock(...args),
}));

vi.mock("../client.js", () => ({
  createMatrixClient: (...args: unknown[]) => createMatrixClientMock(...args),
  isBunRuntime: () => isBunRuntimeMock(),
  resolveMatrixAuth: (...args: unknown[]) => resolveMatrixAuthMock(...args),
  resolveMatrixAuthContext: (...args: unknown[]) => resolveMatrixAuthContextMock(...args),
}));

vi.mock("../../runtime.js", () => ({
  getMatrixRuntime: () => getMatrixRuntimeMock(),
}));

let resolveMatrixClient: typeof import("./client.js").resolveMatrixClient;

function createMockMatrixClient(): MatrixClient {
  return {
    prepareForOneOff: vi.fn(async () => undefined),
  } as unknown as MatrixClient;
}

describe("resolveMatrixClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    getActiveMatrixClientMock.mockReturnValue(null);
    isBunRuntimeMock.mockReturnValue(false);
    getMatrixRuntimeMock.mockReturnValue({
      config: {
        loadConfig: () => ({}),
      },
    });
    resolveMatrixAuthContextMock.mockReturnValue({
      cfg: {},
      env: process.env,
      accountId: "default",
      resolved: {},
    });
    resolveMatrixAuthMock.mockResolvedValue({
      accountId: "default",
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "token",
      password: undefined,
      deviceId: "DEVICE123",
      encryption: false,
    });
    createMatrixClientMock.mockResolvedValue(createMockMatrixClient());

    ({ resolveMatrixClient } = await import("./client.js"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a one-off client even when OPENCLAW_GATEWAY_PORT is set", async () => {
    vi.stubEnv("OPENCLAW_GATEWAY_PORT", "18799");

    const result = await resolveMatrixClient({ accountId: "default" });

    expect(getActiveMatrixClientMock).toHaveBeenCalledWith("default");
    expect(resolveMatrixAuthMock).toHaveBeenCalledTimes(1);
    expect(createMatrixClientMock).toHaveBeenCalledTimes(1);
    expect(createMatrixClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoBootstrapCrypto: false,
      }),
    );
    const oneOffClient = await createMatrixClientMock.mock.results[0]?.value;
    expect(oneOffClient.prepareForOneOff).toHaveBeenCalledTimes(1);
    expect(result.stopOnDone).toBe(true);
  });

  it("reuses active monitor client when available", async () => {
    const activeClient = createMockMatrixClient();
    getActiveMatrixClientMock.mockReturnValue(activeClient);

    const result = await resolveMatrixClient({ accountId: "default" });

    expect(result).toEqual({ client: activeClient, stopOnDone: false });
    expect(resolveMatrixAuthMock).not.toHaveBeenCalled();
    expect(createMatrixClientMock).not.toHaveBeenCalled();
  });

  it("uses the effective account id when auth resolution is implicit", async () => {
    resolveMatrixAuthContextMock.mockReturnValue({
      cfg: {},
      env: process.env,
      accountId: "ops",
      resolved: {},
    });
    resolveMatrixAuthMock.mockResolvedValue({
      accountId: "ops",
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "token",
      password: undefined,
      deviceId: "DEVICE123",
      encryption: false,
    });

    await resolveMatrixClient({});

    expect(getActiveMatrixClientMock).toHaveBeenCalledWith("ops");
    expect(resolveMatrixAuthMock).toHaveBeenCalledWith({
      cfg: {},
      accountId: "ops",
    });
    expect(createMatrixClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ops",
      }),
    );
  });
});
