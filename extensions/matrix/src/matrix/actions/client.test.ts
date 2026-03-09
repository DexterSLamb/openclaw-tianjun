import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockMatrixClient,
  matrixClientResolverMocks,
  primeMatrixClientResolverMocks,
} from "../client-resolver.test-helpers.js";

const {
  loadConfigMock,
  getMatrixRuntimeMock,
  getActiveMatrixClientMock,
  createMatrixClientMock,
  isBunRuntimeMock,
  resolveMatrixAuthMock,
  resolveMatrixAuthContextMock,
} = matrixClientResolverMocks;

vi.mock("../../runtime.js", () => ({
  getMatrixRuntime: () => getMatrixRuntimeMock(),
}));

vi.mock("../active-client.js", () => ({
  getActiveMatrixClient: getActiveMatrixClientMock,
}));

vi.mock("../client.js", () => ({
  createMatrixClient: createMatrixClientMock,
  isBunRuntime: () => isBunRuntimeMock(),
  resolveMatrixAuth: resolveMatrixAuthMock,
  resolveMatrixAuthContext: resolveMatrixAuthContextMock,
}));

let resolveActionClient: typeof import("./client.js").resolveActionClient;

describe("resolveActionClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    primeMatrixClientResolverMocks();

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

  it("skips one-off room preparation when readiness is disabled", async () => {
    const result = await resolveActionClient({
      accountId: "default",
      readiness: "none",
    });

    const oneOffClient = await createMatrixClientMock.mock.results[0]?.value;
    expect(oneOffClient.prepareForOneOff).not.toHaveBeenCalled();
    expect(oneOffClient.start).not.toHaveBeenCalled();
    expect(result.stopOnDone).toBe(true);
  });

  it("starts one-off clients when started readiness is required", async () => {
    const result = await resolveActionClient({
      accountId: "default",
      readiness: "started",
    });

    const oneOffClient = await createMatrixClientMock.mock.results[0]?.value;
    expect(oneOffClient.start).toHaveBeenCalledTimes(1);
    expect(oneOffClient.prepareForOneOff).not.toHaveBeenCalled();
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

  it("starts active clients when started readiness is required", async () => {
    const activeClient = createMockMatrixClient();
    getActiveMatrixClientMock.mockReturnValue(activeClient);

    const result = await resolveActionClient({
      accountId: "default",
      readiness: "started",
    });

    expect(result).toEqual({ client: activeClient, stopOnDone: false });
    expect(activeClient.start).toHaveBeenCalledTimes(1);
    expect(activeClient.prepareForOneOff).not.toHaveBeenCalled();
  });

  it("uses the implicit resolved account id for active client lookup and storage", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        matrix: {
          accounts: {
            ops: {
              homeserver: "https://ops.example.org",
              userId: "@ops:example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    });
    resolveMatrixAuthContextMock.mockReturnValue({
      cfg: loadConfigMock(),
      env: process.env,
      accountId: "ops",
      resolved: {
        homeserver: "https://ops.example.org",
        userId: "@ops:example.org",
        accessToken: "ops-token",
        deviceId: "OPSDEVICE",
        encryption: true,
      },
    });
    resolveMatrixAuthMock.mockResolvedValue({
      accountId: "ops",
      homeserver: "https://ops.example.org",
      userId: "@ops:example.org",
      accessToken: "ops-token",
      password: undefined,
      deviceId: "OPSDEVICE",
      encryption: true,
    });

    await resolveActionClient({});

    expect(getActiveMatrixClientMock).toHaveBeenCalledWith("ops");
    expect(resolveMatrixAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ops",
      }),
    );
    expect(createMatrixClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ops",
        homeserver: "https://ops.example.org",
      }),
    );
  });
});
