import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setMatrixRuntime } from "../../runtime.js";
import { maybeMigrateLegacyStorage, resolveMatrixStoragePaths } from "./storage.js";

describe("matrix client storage paths", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupStateDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-matrix-storage-"));
    tempDirs.push(dir);
    setMatrixRuntime({
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

  it("falls back to migrating the older flat matrix storage layout", () => {
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

    maybeMigrateLegacyStorage({
      storagePaths,
      env: {},
    });

    expect(fs.existsSync(path.join(legacyRoot, "bot-storage.json"))).toBe(false);
    expect(fs.readFileSync(storagePaths.storagePath, "utf8")).toBe('{"legacy":true}');
    expect(fs.existsSync(storagePaths.cryptoPath)).toBe(true);
  });
});
