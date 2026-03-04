import type { RuntimeEnv, WizardPrompter } from "openclaw/plugin-sdk/matrix-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matrixOnboardingAdapter } from "./onboarding.js";
import { setMatrixRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

vi.mock("./matrix/deps.js", () => ({
  ensureMatrixSdkInstalled: vi.fn(async () => {}),
  isMatrixSdkAvailable: vi.fn(() => true),
}));

describe("matrix onboarding", () => {
  const previousEnv = {
    MATRIX_HOMESERVER: process.env.MATRIX_HOMESERVER,
    MATRIX_USER_ID: process.env.MATRIX_USER_ID,
    MATRIX_ACCESS_TOKEN: process.env.MATRIX_ACCESS_TOKEN,
    MATRIX_PASSWORD: process.env.MATRIX_PASSWORD,
    MATRIX_DEVICE_ID: process.env.MATRIX_DEVICE_ID,
    MATRIX_DEVICE_NAME: process.env.MATRIX_DEVICE_NAME,
    MATRIX_OPS_HOMESERVER: process.env.MATRIX_OPS_HOMESERVER,
    MATRIX_OPS_ACCESS_TOKEN: process.env.MATRIX_OPS_ACCESS_TOKEN,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("offers env shortcut for non-default account when scoped env vars are present", async () => {
    setMatrixRuntime({
      state: {
        resolveStateDir: (_env: NodeJS.ProcessEnv, homeDir?: () => string) =>
          (homeDir ?? (() => "/tmp"))(),
      },
      config: {
        loadConfig: () => ({}),
      },
    } as never);

    process.env.MATRIX_HOMESERVER = "https://matrix.env.example.org";
    process.env.MATRIX_USER_ID = "@env:example.org";
    process.env.MATRIX_PASSWORD = "env-password";
    process.env.MATRIX_ACCESS_TOKEN = "";
    process.env.MATRIX_OPS_HOMESERVER = "https://matrix.ops.env.example.org";
    process.env.MATRIX_OPS_ACCESS_TOKEN = "ops-env-token";

    const confirmMessages: string[] = [];
    const prompter = {
      note: vi.fn(async () => {}),
      select: vi.fn(async ({ message }: { message: string }) => {
        if (message === "Matrix-js already configured. What do you want to do?") {
          return "add-account";
        }
        if (message === "Matrix auth method") {
          return "token";
        }
        throw new Error(`unexpected select prompt: ${message}`);
      }),
      text: vi.fn(async ({ message }: { message: string }) => {
        if (message === "Matrix account name") {
          return "ops";
        }
        throw new Error(`unexpected text prompt: ${message}`);
      }),
      confirm: vi.fn(async ({ message }: { message: string }) => {
        confirmMessages.push(message);
        if (message.startsWith("Matrix env vars detected")) {
          return true;
        }
        return false;
      }),
    } as unknown as WizardPrompter;

    const result = await matrixOnboardingAdapter.configureInteractive!({
      cfg: {
        channels: {
          "matrix-js": {
            accounts: {
              default: {
                homeserver: "https://matrix.main.example.org",
                accessToken: "main-token",
              },
            },
          },
        },
      } as CoreConfig,
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() } as unknown as RuntimeEnv,
      prompter,
      options: undefined,
      accountOverrides: {},
      shouldPromptAccountIds: true,
      forceAllowFrom: false,
      configured: true,
      label: "Matrix-js",
    });

    expect(result).not.toBe("skip");
    if (result !== "skip") {
      expect(result.accountId).toBe("ops");
      expect(result.cfg.channels?.["matrix-js"]?.accounts?.ops).toMatchObject({
        enabled: true,
      });
      expect(result.cfg.channels?.["matrix-js"]?.accounts?.ops?.homeserver).toBeUndefined();
      expect(result.cfg.channels?.["matrix-js"]?.accounts?.ops?.accessToken).toBeUndefined();
    }
    expect(
      confirmMessages.some((message) =>
        message.startsWith(
          "Matrix env vars detected (MATRIX_OPS_HOMESERVER (+ auth vars)). Use env values?",
        ),
      ),
    ).toBe(true);
  });

  it("includes device env var names in auth help text", async () => {
    setMatrixRuntime({
      state: {
        resolveStateDir: (_env: NodeJS.ProcessEnv, homeDir?: () => string) =>
          (homeDir ?? (() => "/tmp"))(),
      },
      config: {
        loadConfig: () => ({}),
      },
    } as never);

    const notes: string[] = [];
    const prompter = {
      note: vi.fn(async (message: unknown) => {
        notes.push(String(message));
      }),
      text: vi.fn(async () => {
        throw new Error("stop-after-help");
      }),
      confirm: vi.fn(async () => false),
      select: vi.fn(async () => "token"),
    } as unknown as WizardPrompter;

    await expect(
      matrixOnboardingAdapter.configureInteractive!({
        cfg: { channels: {} } as CoreConfig,
        runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() } as unknown as RuntimeEnv,
        prompter,
        options: undefined,
        accountOverrides: {},
        shouldPromptAccountIds: false,
        forceAllowFrom: false,
        configured: false,
        label: "Matrix-js",
      }),
    ).rejects.toThrow("stop-after-help");

    const noteText = notes.join("\n");
    expect(noteText).toContain("MATRIX_DEVICE_ID");
    expect(noteText).toContain("MATRIX_DEVICE_NAME");
    expect(noteText).toContain("MATRIX_<ACCOUNT_ID>_DEVICE_ID");
    expect(noteText).toContain("MATRIX_<ACCOUNT_ID>_DEVICE_NAME");
  });
});
