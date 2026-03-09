import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempHome } from "../../test/helpers/temp-home.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  detectMatrixInstallPathIssue,
  formatMatrixInstallPathIssue,
} from "./matrix-install-path-warnings.js";

describe("matrix install path warnings", () => {
  it("detects stale custom Matrix plugin paths", async () => {
    const cfg: OpenClawConfig = {
      plugins: {
        installs: {
          matrix: {
            source: "path",
            sourcePath: "/tmp/openclaw-matrix-missing",
            installPath: "/tmp/openclaw-matrix-missing",
          },
        },
      },
    };

    const issue = await detectMatrixInstallPathIssue(cfg);
    expect(issue).toEqual({ missingPath: "/tmp/openclaw-matrix-missing" });
    expect(
      formatMatrixInstallPathIssue({
        issue: issue!,
      }),
    ).toEqual([
      "Matrix is installed from a custom path that no longer exists: /tmp/openclaw-matrix-missing",
      'Reinstall with "openclaw plugins install @openclaw/matrix".',
      'If you are running from a repo checkout, you can also use "openclaw plugins install ./extensions/matrix".',
    ]);
  });

  it("skips warnings when the configured custom path exists", async () => {
    await withTempHome(async (home) => {
      const pluginPath = path.join(home, "matrix-plugin");
      await fs.mkdir(pluginPath, { recursive: true });

      const cfg: OpenClawConfig = {
        plugins: {
          installs: {
            matrix: {
              source: "path",
              sourcePath: pluginPath,
              installPath: pluginPath,
            },
          },
        },
      };

      await expect(detectMatrixInstallPathIssue(cfg)).resolves.toBeNull();
    });
  });
});
