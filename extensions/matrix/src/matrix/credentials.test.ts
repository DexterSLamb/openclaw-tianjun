import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setMatrixRuntime } from "../runtime.js";
import {
  loadMatrixCredentials,
  clearMatrixCredentials,
  resolveMatrixCredentialsPath,
  saveMatrixCredentials,
  touchMatrixCredentials,
} from "./credentials.js";

describe("matrix credentials storage", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupStateDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-matrix-creds-"));
    tempDirs.push(dir);
    setMatrixRuntime({
      state: {
        resolveStateDir: () => dir,
      },
    } as never);
    return dir;
  }

  it("writes credentials atomically with secure file permissions", async () => {
    const stateDir = setupStateDir();
    await saveMatrixCredentials(
      {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "secret-token",
        deviceId: "DEVICE123",
      },
      {},
      "ops",
    );

    const credPath = resolveMatrixCredentialsPath({}, "ops");
    expect(fs.existsSync(credPath)).toBe(true);
    expect(credPath).toBe(path.join(stateDir, "credentials", "matrix", "credentials-ops.json"));
    const mode = fs.statSync(credPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("touch updates lastUsedAt while preserving createdAt", async () => {
    setupStateDir();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
      await saveMatrixCredentials(
        {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          accessToken: "secret-token",
        },
        {},
        "default",
      );
      const initial = loadMatrixCredentials({}, "default");
      expect(initial).not.toBeNull();

      vi.setSystemTime(new Date("2026-03-01T10:05:00.000Z"));
      await touchMatrixCredentials({}, "default");
      const touched = loadMatrixCredentials({}, "default");
      expect(touched).not.toBeNull();

      expect(touched?.createdAt).toBe(initial?.createdAt);
      expect(touched?.lastUsedAt).toBe("2026-03-01T10:05:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("migrates legacy matrix credential files on read", async () => {
    const stateDir = setupStateDir();
    const legacyPath = path.join(stateDir, "credentials", "matrix", "credentials.json");
    const currentPath = resolveMatrixCredentialsPath({}, "ops");
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "legacy-token",
        createdAt: "2026-03-01T10:00:00.000Z",
      }),
    );

    const loaded = loadMatrixCredentials({}, "ops");

    expect(loaded?.accessToken).toBe("legacy-token");
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(fs.existsSync(currentPath)).toBe(true);
  });

  it("clears both current and legacy credential paths", () => {
    const stateDir = setupStateDir();
    const currentPath = resolveMatrixCredentialsPath({}, "ops");
    const legacyPath = path.join(stateDir, "credentials", "matrix", "credentials.json");
    fs.mkdirSync(path.dirname(currentPath), { recursive: true });
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(currentPath, "{}");
    fs.writeFileSync(legacyPath, "{}");

    clearMatrixCredentials({}, "ops");

    expect(fs.existsSync(currentPath)).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});
