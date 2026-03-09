import { vi } from "vitest";
import type { MatrixClient } from "./sdk.js";

export const matrixClientResolverMocks = {
  loadConfigMock: vi.fn(() => ({})),
  getMatrixRuntimeMock: vi.fn(),
  getActiveMatrixClientMock: vi.fn(),
  createMatrixClientMock: vi.fn(),
  isBunRuntimeMock: vi.fn(() => false),
  resolveMatrixAuthMock: vi.fn(),
  resolveMatrixAuthContextMock: vi.fn(),
};

export function createMockMatrixClient(): MatrixClient {
  return {
    prepareForOneOff: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
  } as unknown as MatrixClient;
}

export function primeMatrixClientResolverMocks(params?: {
  cfg?: unknown;
  accountId?: string;
  resolved?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  client?: MatrixClient;
}): MatrixClient {
  const {
    loadConfigMock,
    getMatrixRuntimeMock,
    getActiveMatrixClientMock,
    createMatrixClientMock,
    isBunRuntimeMock,
    resolveMatrixAuthMock,
    resolveMatrixAuthContextMock,
  } = matrixClientResolverMocks;

  const cfg = params?.cfg ?? {};
  const accountId = params?.accountId ?? "default";
  const defaultResolved = {
    homeserver: "https://matrix.example.org",
    userId: "@bot:example.org",
    accessToken: "token",
    password: undefined,
    deviceId: "DEVICE123",
    encryption: false,
  };
  const defaultAuth = {
    accountId,
    homeserver: "https://matrix.example.org",
    userId: "@bot:example.org",
    accessToken: "token",
    password: undefined,
    deviceId: "DEVICE123",
    encryption: false,
  };
  const client = params?.client ?? createMockMatrixClient();

  vi.clearAllMocks();
  loadConfigMock.mockReturnValue(cfg);
  getMatrixRuntimeMock.mockReturnValue({
    config: {
      loadConfig: loadConfigMock,
    },
  });
  getActiveMatrixClientMock.mockReturnValue(null);
  isBunRuntimeMock.mockReturnValue(false);
  resolveMatrixAuthContextMock.mockImplementation(
    ({
      cfg: explicitCfg,
      accountId: explicitAccountId,
    }: {
      cfg: unknown;
      accountId?: string | null;
    }) => ({
      cfg: explicitCfg,
      env: process.env,
      accountId: explicitAccountId ?? accountId,
      resolved: {
        ...defaultResolved,
        ...params?.resolved,
      },
    }),
  );
  resolveMatrixAuthMock.mockResolvedValue({
    ...defaultAuth,
    ...params?.auth,
  });
  createMatrixClientMock.mockResolvedValue(client);

  return client;
}
