import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../test/helpers/temp-home.js";
import type { OpenClawConfig } from "../config/config.js";
import { autoPrepareLegacyMatrixCrypto, detectLegacyMatrixCrypto } from "./matrix-legacy-crypto.js";
import { resolveMatrixAccountStorageRoot } from "./matrix-storage-paths.js";

function writeFile(filePath: string, value: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

describe("matrix legacy encrypted-state migration", () => {
  it("extracts a saved backup key into the new recovery-key path", async () => {
    await withTempHome(async (home) => {
      const stateDir = path.join(home, ".openclaw");
      const cfg: OpenClawConfig = {
        channels: {
          matrix: {
            homeserver: "https://matrix.example.org",
            userId: "@bot:example.org",
            accessToken: "tok-123",
          },
        },
      };
      const { rootDir } = resolveMatrixAccountStorageRoot({
        stateDir,
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "tok-123",
      });
      writeFile(path.join(rootDir, "crypto", "bot-sdk.json"), '{"deviceId":"DEVICE123"}');

      const detection = detectLegacyMatrixCrypto({ cfg, env: process.env });
      expect(detection.warnings).toEqual([]);
      expect(detection.plans).toHaveLength(1);

      const inspectLegacyStore = vi.fn(async () => ({
        deviceId: "DEVICE123",
        roomKeyCounts: { total: 12, backedUp: 12 },
        backupVersion: "1",
        decryptionKeyBase64: "YWJjZA==",
      }));

      const result = await autoPrepareLegacyMatrixCrypto({
        cfg,
        env: process.env,
        deps: { inspectLegacyStore },
      });

      expect(result.migrated).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(inspectLegacyStore).toHaveBeenCalledOnce();

      const recovery = JSON.parse(
        fs.readFileSync(path.join(rootDir, "recovery-key.json"), "utf8"),
      ) as {
        privateKeyBase64: string;
      };
      expect(recovery.privateKeyBase64).toBe("YWJjZA==");

      const state = JSON.parse(
        fs.readFileSync(path.join(rootDir, "legacy-crypto-migration.json"), "utf8"),
      ) as {
        restoreStatus: string;
        decryptionKeyImported: boolean;
      };
      expect(state.restoreStatus).toBe("pending");
      expect(state.decryptionKeyImported).toBe(true);
    });
  });

  it("warns when legacy local-only room keys cannot be recovered automatically", async () => {
    await withTempHome(async (home) => {
      const stateDir = path.join(home, ".openclaw");
      const cfg: OpenClawConfig = {
        channels: {
          matrix: {
            homeserver: "https://matrix.example.org",
            userId: "@bot:example.org",
            accessToken: "tok-123",
          },
        },
      };
      const { rootDir } = resolveMatrixAccountStorageRoot({
        stateDir,
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "tok-123",
      });
      writeFile(path.join(rootDir, "crypto", "bot-sdk.json"), '{"deviceId":"DEVICE123"}');

      const result = await autoPrepareLegacyMatrixCrypto({
        cfg,
        env: process.env,
        deps: {
          inspectLegacyStore: async () => ({
            deviceId: "DEVICE123",
            roomKeyCounts: { total: 15, backedUp: 10 },
            backupVersion: null,
            decryptionKeyBase64: null,
          }),
        },
      });

      expect(result.migrated).toBe(true);
      expect(result.warnings).toContain(
        'Legacy Matrix encrypted state for account "default" contains 5 room key(s) that were never backed up. Backed-up keys can be restored automatically, but local-only encrypted history may remain unavailable after upgrade.',
      );
      expect(result.warnings).toContain(
        'Legacy Matrix encrypted state for account "default" cannot be fully converted automatically because the old rust crypto store does not expose all local room keys for export.',
      );
      const state = JSON.parse(
        fs.readFileSync(path.join(rootDir, "legacy-crypto-migration.json"), "utf8"),
      ) as {
        restoreStatus: string;
      };
      expect(state.restoreStatus).toBe("manual-action-required");
    });
  });
});
