import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setMatrixRuntime } from "../../runtime.js";
import { maybeMigrateLegacyStorage, resolveMatrixStoragePaths } from "./storage.js";

const maybeCreateMatrixMigrationSnapshotMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("openclaw/plugin-sdk/matrix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/matrix")>();
  return {
    ...actual,
    maybeCreateMatrixMigrationSnapshot: (params: unknown) =>
      maybeCreateMatrixMigrationSnapshotMock(params),
  };
});

describe("matrix client storage paths", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    maybeCreateMatrixMigrationSnapshotMock.mockReset();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupStateDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-matrix-storage-"));
    tempDirs.push(dir);
    setMatrixRuntime({
      logging: {
        getChildLogger: () => ({
          info: () => {},
          warn: () => {},
          error: () => {},
        }),
      },
      state: {
        resolveStateDir: () => dir,
      },
    } as never);
    return dir;
  }

  it("uses the simplified matrix runtime root for account-scoped storage", () => {
    const stateDir = setupStateDir();

    const storagePaths = resolveMatrixStoragePaths({
      homeserver: "https://matrix.example.org",
      userId: "@Bot:example.org",
      accessToken: "secret-token",
      accountId: "ops",
      env: {},
    });

    expect(storagePaths.rootDir).toBe(
      path.join(
        stateDir,
        "matrix",
        "accounts",
        "ops",
        "matrix.example.org__bot_example.org",
        storagePaths.tokenHash,
      ),
    );
    expect(storagePaths.storagePath).toBe(path.join(storagePaths.rootDir, "bot-storage.json"));
    expect(storagePaths.cryptoPath).toBe(path.join(storagePaths.rootDir, "crypto"));
    expect(storagePaths.metaPath).toBe(path.join(storagePaths.rootDir, "storage-meta.json"));
    expect(storagePaths.recoveryKeyPath).toBe(path.join(storagePaths.rootDir, "recovery-key.json"));
    expect(storagePaths.idbSnapshotPath).toBe(
      path.join(storagePaths.rootDir, "crypto-idb-snapshot.json"),
    );
  });

  it("falls back to migrating the older flat matrix storage layout", async () => {
    const stateDir = setupStateDir();
    const storagePaths = resolveMatrixStoragePaths({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "secret-token",
      env: {},
    });
    const legacyRoot = path.join(stateDir, "matrix");
    fs.mkdirSync(path.join(legacyRoot, "crypto"), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "bot-storage.json"), '{"legacy":true}');

    await maybeMigrateLegacyStorage({
      storagePaths,
      env: {},
    });

    expect(maybeCreateMatrixMigrationSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "matrix-client-fallback" }),
    );
    expect(fs.existsSync(path.join(legacyRoot, "bot-storage.json"))).toBe(false);
    expect(fs.readFileSync(storagePaths.storagePath, "utf8")).toBe('{"legacy":true}');
    expect(fs.existsSync(storagePaths.cryptoPath)).toBe(true);
  });

  it("refuses to migrate legacy storage when the snapshot step fails", async () => {
    const stateDir = setupStateDir();
    const storagePaths = resolveMatrixStoragePaths({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "secret-token",
      env: {},
    });
    const legacyRoot = path.join(stateDir, "matrix");
    fs.mkdirSync(path.join(legacyRoot, "crypto"), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "bot-storage.json"), '{"legacy":true}');
    maybeCreateMatrixMigrationSnapshotMock.mockRejectedValueOnce(new Error("snapshot failed"));

    await expect(
      maybeMigrateLegacyStorage({
        storagePaths,
        env: {},
      }),
    ).rejects.toThrow("snapshot failed");
    expect(fs.existsSync(path.join(legacyRoot, "bot-storage.json"))).toBe(true);
    expect(fs.existsSync(storagePaths.storagePath)).toBe(false);
  });

  it("rolls back moved legacy storage when the crypto move fails", async () => {
    const stateDir = setupStateDir();
    const storagePaths = resolveMatrixStoragePaths({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "secret-token",
      env: {},
    });
    const legacyRoot = path.join(stateDir, "matrix");
    fs.mkdirSync(path.join(legacyRoot, "crypto"), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "bot-storage.json"), '{"legacy":true}');
    const realRenameSync = fs.renameSync.bind(fs);
    const renameSync = vi.spyOn(fs, "renameSync");
    renameSync.mockImplementation((sourcePath, targetPath) => {
      if (String(targetPath) === storagePaths.cryptoPath) {
        throw new Error("disk full");
      }
      return realRenameSync(sourcePath, targetPath);
    });

    await expect(
      maybeMigrateLegacyStorage({
        storagePaths,
        env: {},
      }),
    ).rejects.toThrow("disk full");
    expect(fs.existsSync(path.join(legacyRoot, "bot-storage.json"))).toBe(true);
    expect(fs.existsSync(storagePaths.storagePath)).toBe(false);
    expect(fs.existsSync(path.join(legacyRoot, "crypto"))).toBe(true);
  });
});
