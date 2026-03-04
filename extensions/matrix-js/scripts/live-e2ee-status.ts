import {
  getMatrixEncryptionStatus,
  getMatrixVerificationStatus,
  verifyMatrixRecoveryKey,
} from "../src/matrix/actions.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

async function main() {
  const includeRecoveryKey = process.argv.includes("--include-recovery-key");
  const verifyStoredRecoveryKey = process.argv.includes("--verify-stored-recovery-key");

  const base = resolveLiveHarnessConfig();
  const pluginCfg = installLiveHarnessRuntime(base);
  (pluginCfg.channels["matrix-js"] as { encryption: boolean }).encryption = true;

  const verification = await getMatrixVerificationStatus({
    includeRecoveryKey,
  });
  const encryption = await getMatrixEncryptionStatus({
    includeRecoveryKey,
  });

  let recoveryVerificationResult: unknown = null;
  if (verifyStoredRecoveryKey) {
    const key =
      verification && typeof verification === "object" && "recoveryKey" in verification
        ? (verification as { recoveryKey?: string | null }).recoveryKey
        : null;
    if (key?.trim()) {
      recoveryVerificationResult = await verifyMatrixRecoveryKey(key);
    } else {
      recoveryVerificationResult = {
        success: false,
        error: "No stored recovery key returned (use --include-recovery-key)",
      };
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        homeserver: base.homeserver,
        userId: base.userId,
        verification,
        encryption,
        recoveryVerificationResult,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`E2EE_STATUS_ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
