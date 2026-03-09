import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "../sdk.js";

const loadConfigMock = vi.fn(() => ({}));
const getActiveMatrixClientMock = vi.fn();
const createMatrixClientMock = vi.fn();
const isBunRuntimeMock = vi.fn(() => false);
const resolveMatrixAuthMock = vi.fn();

vi.mock("../../runtime.js", () => ({
  getMatrixRuntime: () => ({
    config: {
      loadConfig: loadConfigMock,
    },
  }),
}));

vi.mock("../active-client.js", () => ({
  getActiveMatrixClient: getActiveMatrixClientMock,
}));

vi.mock("../client.js", () => ({
  createMatrixClient: createMatrixClientMock,
  isBunRuntime: () => isBunRuntimeMock(),
  resolveMatrixAuth: resolveMatrixAuthMock,
}));

let resolveActionClient: typeof import("./client.js").resolveActionClient;

function createMockMatrixClient(): MatrixClient {
  return {
    prepareForOneOff: vi.fn(async () => undefined),
  } as unknown as MatrixClient;
}

describe("resolveActionClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    getActiveMatrixClientMock.mockReturnValue(null);
    isBunRuntimeMock.mockReturnValue(false);
    resolveMatrixAuthMock.mockResolvedValue({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "token",
      password: undefined,
      deviceId: "DEVICE123",
      encryption: false,
    });
    createMatrixClientMock.mockResolvedValue(createMockMatrixClient());

    ({ resolveActionClient } = await import("./client.js"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a one-off client even when OPENCLAW_GATEWAY_PORT is set", async () => {
    vi.stubEnv("OPENCLAW_GATEWAY_PORT", "18799");

    const result = await resolveActionClient({ accountId: "default" });

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

    const result = await resolveActionClient({ accountId: "default" });

    expect(result).toEqual({ client: activeClient, stopOnDone: false });
    expect(resolveMatrixAuthMock).not.toHaveBeenCalled();
    expect(createMatrixClientMock).not.toHaveBeenCalled();
  });
});
