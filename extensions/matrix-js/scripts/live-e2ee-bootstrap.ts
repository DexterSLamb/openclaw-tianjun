import { bootstrapMatrixVerification } from "../src/matrix/actions/verification.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

async function main() {
  const recoveryKeyArg = process.argv[2];
  const forceResetCrossSigning = process.argv.includes("--force-reset-cross-signing");

  const base = resolveLiveHarnessConfig();
  const pluginCfg = installLiveHarnessRuntime(base);
  (pluginCfg.channels["matrix-js"] as { encryption: boolean }).encryption = true;

  const result = await bootstrapMatrixVerification({
    recoveryKey: recoveryKeyArg?.trim() || undefined,
    forceResetCrossSigning,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(
    `E2EE_BOOTSTRAP_ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
