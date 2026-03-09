import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";

export type MatrixInstallPathIssue = {
  missingPath: string;
};

function resolveMatrixInstallCandidatePaths(cfg: OpenClawConfig): string[] {
  const install = cfg.plugins?.installs?.matrix;
  if (!install || install.source !== "path") {
    return [];
  }

  return [install.sourcePath, install.installPath]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

export async function detectMatrixInstallPathIssue(
  cfg: OpenClawConfig,
): Promise<MatrixInstallPathIssue | null> {
  const candidatePaths = resolveMatrixInstallCandidatePaths(cfg);
  if (candidatePaths.length === 0) {
    return null;
  }

  for (const candidatePath of candidatePaths) {
    try {
      await fs.access(path.resolve(candidatePath));
      return null;
    } catch {
      // keep checking remaining candidates
    }
  }

  return {
    missingPath: candidatePaths[0] ?? "(unknown)",
  };
}

export function formatMatrixInstallPathIssue(params: {
  issue: MatrixInstallPathIssue;
  formatCommand?: (command: string) => string;
}): string[] {
  const formatCommand = params.formatCommand ?? ((command: string) => command);
  return [
    `Matrix is installed from a custom path that no longer exists: ${params.issue.missingPath}`,
    `Reinstall with "${formatCommand("openclaw plugins install @openclaw/matrix")}".`,
    `If you are running from a repo checkout, you can also use "${formatCommand("openclaw plugins install ./extensions/matrix")}".`,
  ];
}
