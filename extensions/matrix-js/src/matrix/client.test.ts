import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../types.js";
import { resolveMatrixAuth, resolveMatrixConfig, resolveMatrixConfigForAccount } from "./client.js";
import * as credentialsModule from "./credentials.js";
import * as sdkModule from "./sdk.js";

const saveMatrixCredentialsMock = vi.hoisted(() => vi.fn());

vi.mock("./credentials.js", () => ({
  loadMatrixCredentials: vi.fn(() => null),
  saveMatrixCredentials: saveMatrixCredentialsMock,
  credentialsMatchConfig: vi.fn(() => false),
  touchMatrixCredentials: vi.fn(),
}));

describe("resolveMatrixConfig", () => {
  it("prefers config over env", () => {
    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://cfg.example.org",
          userId: "@cfg:example.org",
          accessToken: "cfg-token",
          password: "cfg-pass",
          deviceName: "CfgDevice",
          initialSyncLimit: 5,
        },
      },
    } as CoreConfig;
    const env = {
      MATRIX_HOMESERVER: "https://env.example.org",
      MATRIX_USER_ID: "@env:example.org",
      MATRIX_ACCESS_TOKEN: "env-token",
      MATRIX_PASSWORD: "env-pass",
      MATRIX_DEVICE_NAME: "EnvDevice",
    } as NodeJS.ProcessEnv;
    const resolved = resolveMatrixConfig(cfg, env);
    expect(resolved).toEqual({
      homeserver: "https://cfg.example.org",
      userId: "@cfg:example.org",
      accessToken: "cfg-token",
      password: "cfg-pass",
      deviceId: undefined,
      deviceName: "CfgDevice",
      initialSyncLimit: 5,
      encryption: false,
    });
  });

  it("uses env when config is missing", () => {
    const cfg = {} as CoreConfig;
    const env = {
      MATRIX_HOMESERVER: "https://env.example.org",
      MATRIX_USER_ID: "@env:example.org",
      MATRIX_ACCESS_TOKEN: "env-token",
      MATRIX_PASSWORD: "env-pass",
      MATRIX_DEVICE_ID: "ENVDEVICE",
      MATRIX_DEVICE_NAME: "EnvDevice",
    } as NodeJS.ProcessEnv;
    const resolved = resolveMatrixConfig(cfg, env);
    expect(resolved.homeserver).toBe("https://env.example.org");
    expect(resolved.userId).toBe("@env:example.org");
    expect(resolved.accessToken).toBe("env-token");
    expect(resolved.password).toBe("env-pass");
    expect(resolved.deviceId).toBe("ENVDEVICE");
    expect(resolved.deviceName).toBe("EnvDevice");
    expect(resolved.initialSyncLimit).toBeUndefined();
    expect(resolved.encryption).toBe(false);
  });

  it("uses account-scoped env vars for non-default accounts before global env", () => {
    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://base.example.org",
        },
      },
    } as CoreConfig;
    const env = {
      MATRIX_HOMESERVER: "https://global.example.org",
      MATRIX_ACCESS_TOKEN: "global-token",
      MATRIX_OPS_HOMESERVER: "https://ops.example.org",
      MATRIX_OPS_ACCESS_TOKEN: "ops-token",
      MATRIX_OPS_DEVICE_NAME: "Ops Device",
    } as NodeJS.ProcessEnv;

    const resolved = resolveMatrixConfigForAccount(cfg, "ops", env);
    expect(resolved.homeserver).toBe("https://ops.example.org");
    expect(resolved.accessToken).toBe("ops-token");
    expect(resolved.deviceName).toBe("Ops Device");
  });
});

describe("resolveMatrixAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    saveMatrixCredentialsMock.mockReset();
  });

  it("uses the hardened client request path for password login and persists deviceId", async () => {
    const doRequestSpy = vi.spyOn(sdkModule.MatrixClient.prototype, "doRequest").mockResolvedValue({
      access_token: "tok-123",
      user_id: "@bot:example.org",
      device_id: "DEVICE123",
    });

    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          password: "secret",
          encryption: true,
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({
      cfg,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(doRequestSpy).toHaveBeenCalledWith(
      "POST",
      "/_matrix/client/v3/login",
      undefined,
      expect.objectContaining({
        type: "m.login.password",
      }),
    );
    expect(auth).toMatchObject({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok-123",
      deviceId: "DEVICE123",
      encryption: true,
    });
    expect(saveMatrixCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "tok-123",
        deviceId: "DEVICE123",
      }),
      expect.any(Object),
      undefined,
    );
  });

  it("surfaces password login errors when account credentials are invalid", async () => {
    const doRequestSpy = vi.spyOn(sdkModule.MatrixClient.prototype, "doRequest");
    doRequestSpy.mockRejectedValueOnce(new Error("Invalid username or password"));

    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          password: "secret",
        },
      },
    } as CoreConfig;

    await expect(
      resolveMatrixAuth({
        cfg,
        env: {} as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow("Invalid username or password");

    expect(doRequestSpy).toHaveBeenCalledWith(
      "POST",
      "/_matrix/client/v3/login",
      undefined,
      expect.objectContaining({
        type: "m.login.password",
      }),
    );
    expect(saveMatrixCredentialsMock).not.toHaveBeenCalled();
  });

  it("uses cached matching credentials when access token is not configured", async () => {
    vi.mocked(credentialsModule.loadMatrixCredentials).mockReturnValue({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "cached-token",
      deviceId: "CACHEDDEVICE",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(credentialsModule.credentialsMatchConfig).mockReturnValue(true);

    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          password: "secret",
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({
      cfg,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(auth).toMatchObject({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "cached-token",
      deviceId: "CACHEDDEVICE",
    });
    expect(saveMatrixCredentialsMock).not.toHaveBeenCalled();
  });

  it("falls back to config deviceId when cached credentials are missing it", async () => {
    vi.mocked(credentialsModule.loadMatrixCredentials).mockReturnValue({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok-123",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(credentialsModule.credentialsMatchConfig).mockReturnValue(true);

    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          accessToken: "tok-123",
          deviceId: "DEVICE123",
          encryption: true,
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    expect(auth.deviceId).toBe("DEVICE123");
    expect(saveMatrixCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "tok-123",
        deviceId: "DEVICE123",
      }),
      expect.any(Object),
      undefined,
    );
  });

  it("resolves missing whoami identity fields for token auth", async () => {
    const doRequestSpy = vi.spyOn(sdkModule.MatrixClient.prototype, "doRequest").mockResolvedValue({
      user_id: "@bot:example.org",
      device_id: "DEVICE123",
    });

    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://matrix.example.org",
          accessToken: "tok-123",
          encryption: true,
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({
      cfg,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(doRequestSpy).toHaveBeenCalledWith("GET", "/_matrix/client/v3/account/whoami");
    expect(auth).toMatchObject({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok-123",
      deviceId: "DEVICE123",
      encryption: true,
    });
  });

  it("uses config deviceId with cached credentials when token is loaded from cache", async () => {
    vi.mocked(credentialsModule.loadMatrixCredentials).mockReturnValue({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok-123",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(credentialsModule.credentialsMatchConfig).mockReturnValue(true);

    const cfg = {
      channels: {
        "matrix-js": {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          deviceId: "DEVICE123",
          encryption: true,
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    expect(auth).toMatchObject({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok-123",
      deviceId: "DEVICE123",
      encryption: true,
    });
  });
});
