import type { Command } from "commander";
import {
  formatZonedTimestamp,
  normalizeAccountId,
  type ChannelSetupInput,
} from "openclaw/plugin-sdk/matrix-js";
import { matrixPlugin } from "./channel.js";
import { updateMatrixOwnProfile } from "./matrix/actions/profile.js";
import {
  bootstrapMatrixVerification,
  getMatrixRoomKeyBackupStatus,
  getMatrixVerificationStatus,
  restoreMatrixRoomKeyBackup,
  verifyMatrixRecoveryKey,
} from "./matrix/actions/verification.js";
import { setMatrixSdkLogMode } from "./matrix/client/logging.js";
import { updateMatrixAccountConfig } from "./matrix/config-update.js";
import { getMatrixRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

let matrixJsCliExitScheduled = false;

function scheduleMatrixJsCliExit(): void {
  if (matrixJsCliExitScheduled || process.env.VITEST) {
    return;
  }
  matrixJsCliExitScheduled = true;
  // matrix-js-sdk rust crypto can leave background async work alive after command completion.
  setTimeout(() => {
    process.exit(process.exitCode ?? 0);
  }, 0);
}

function markCliFailure(): void {
  process.exitCode = 1;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function formatLocalTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }
  return formatZonedTimestamp(parsed, { displaySeconds: true }) ?? value;
}

function printTimestamp(label: string, value: string | null | undefined): void {
  const formatted = formatLocalTimestamp(value);
  if (formatted) {
    console.log(`${label}: ${formatted}`);
  }
}

function printAccountLabel(accountId?: string): void {
  console.log(`Account: ${normalizeAccountId(accountId)}`);
}

function configureCliLogMode(verbose: boolean): void {
  setMatrixSdkLogMode(verbose ? "default" : "quiet");
}

function parseOptionalInt(value: string | undefined, fieldName: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

type MatrixCliAccountAddResult = {
  accountId: string;
  configPath: string;
  useEnv: boolean;
  profile: {
    attempted: boolean;
    displayNameUpdated: boolean;
    avatarUpdated: boolean;
    resolvedAvatarUrl: string | null;
    convertedAvatarFromHttp: boolean;
    error?: string;
  };
};

async function addMatrixJsAccount(params: {
  account?: string;
  name?: string;
  avatarUrl?: string;
  homeserver?: string;
  userId?: string;
  accessToken?: string;
  password?: string;
  deviceName?: string;
  initialSyncLimit?: string;
  useEnv?: boolean;
}): Promise<MatrixCliAccountAddResult> {
  const runtime = getMatrixRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const setup = matrixPlugin.setup;
  if (!setup?.applyAccountConfig) {
    throw new Error("Matrix-js account setup is unavailable.");
  }

  const input: ChannelSetupInput & { avatarUrl?: string } = {
    name: params.name,
    avatarUrl: params.avatarUrl,
    homeserver: params.homeserver,
    userId: params.userId,
    accessToken: params.accessToken,
    password: params.password,
    deviceName: params.deviceName,
    initialSyncLimit: parseOptionalInt(params.initialSyncLimit, "--initial-sync-limit"),
    useEnv: params.useEnv === true,
  };
  const accountId =
    setup.resolveAccountId?.({
      cfg,
      accountId: params.account,
      input,
    }) ?? normalizeAccountId(params.account?.trim() || params.name?.trim());

  const validationError = setup.validateInput?.({
    cfg,
    accountId,
    input,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  const updated = setup.applyAccountConfig({
    cfg,
    accountId,
    input,
  }) as CoreConfig;
  await runtime.config.writeConfigFile(updated as never);

  const desiredDisplayName = input.name?.trim();
  const desiredAvatarUrl = input.avatarUrl?.trim();
  let profile: MatrixCliAccountAddResult["profile"] = {
    attempted: false,
    displayNameUpdated: false,
    avatarUpdated: false,
    resolvedAvatarUrl: null,
    convertedAvatarFromHttp: false,
  };
  if (desiredDisplayName || desiredAvatarUrl) {
    try {
      const synced = await updateMatrixOwnProfile({
        accountId,
        displayName: desiredDisplayName,
        avatarUrl: desiredAvatarUrl,
      });
      let resolvedAvatarUrl = synced.resolvedAvatarUrl;
      if (synced.convertedAvatarFromHttp && synced.resolvedAvatarUrl) {
        const latestCfg = runtime.config.loadConfig() as CoreConfig;
        const withAvatar = updateMatrixAccountConfig(latestCfg, accountId, {
          avatarUrl: synced.resolvedAvatarUrl,
        });
        await runtime.config.writeConfigFile(withAvatar as never);
        resolvedAvatarUrl = synced.resolvedAvatarUrl;
      }
      profile = {
        attempted: true,
        displayNameUpdated: synced.displayNameUpdated,
        avatarUpdated: synced.avatarUpdated,
        resolvedAvatarUrl,
        convertedAvatarFromHttp: synced.convertedAvatarFromHttp,
      };
    } catch (err) {
      profile = {
        attempted: true,
        displayNameUpdated: false,
        avatarUpdated: false,
        resolvedAvatarUrl: null,
        convertedAvatarFromHttp: false,
        error: toErrorMessage(err),
      };
    }
  }

  return {
    accountId,
    configPath: `channels.matrix-js.accounts.${accountId}`,
    useEnv: input.useEnv === true,
    profile,
  };
}

type MatrixCliProfileSetResult = {
  accountId: string;
  displayName: string | null;
  avatarUrl: string | null;
  profile: {
    displayNameUpdated: boolean;
    avatarUpdated: boolean;
    resolvedAvatarUrl: string | null;
    convertedAvatarFromHttp: boolean;
  };
  configPath: string;
};

async function setMatrixJsProfile(params: {
  account?: string;
  name?: string;
  avatarUrl?: string;
}): Promise<MatrixCliProfileSetResult> {
  const runtime = getMatrixRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const accountId = normalizeAccountId(params.account);
  const displayName = params.name?.trim() || null;
  const avatarUrl = params.avatarUrl?.trim() || null;
  if (!displayName && !avatarUrl) {
    throw new Error("Provide --name and/or --avatar-url.");
  }

  const synced = await updateMatrixOwnProfile({
    accountId,
    displayName: displayName ?? undefined,
    avatarUrl: avatarUrl ?? undefined,
  });
  const persistedAvatarUrl =
    synced.convertedAvatarFromHttp && synced.resolvedAvatarUrl
      ? synced.resolvedAvatarUrl
      : avatarUrl;
  const updated = updateMatrixAccountConfig(cfg, accountId, {
    name: displayName ?? undefined,
    avatarUrl: persistedAvatarUrl ?? undefined,
  });
  await runtime.config.writeConfigFile(updated as never);

  return {
    accountId,
    displayName,
    avatarUrl: persistedAvatarUrl ?? null,
    profile: {
      displayNameUpdated: synced.displayNameUpdated,
      avatarUpdated: synced.avatarUpdated,
      resolvedAvatarUrl: synced.resolvedAvatarUrl,
      convertedAvatarFromHttp: synced.convertedAvatarFromHttp,
    },
    configPath: `channels.matrix-js.accounts.${accountId}`,
  };
}

type MatrixCliCommandConfig<TResult> = {
  verbose: boolean;
  json: boolean;
  run: () => Promise<TResult>;
  onText: (result: TResult, verbose: boolean) => void;
  onJson?: (result: TResult) => unknown;
  shouldFail?: (result: TResult) => boolean;
  errorPrefix: string;
  onJsonError?: (message: string) => unknown;
};

async function runMatrixCliCommand<TResult>(
  config: MatrixCliCommandConfig<TResult>,
): Promise<void> {
  configureCliLogMode(config.verbose);
  try {
    const result = await config.run();
    if (config.json) {
      printJson(config.onJson ? config.onJson(result) : result);
    } else {
      config.onText(result, config.verbose);
    }
    if (config.shouldFail?.(result)) {
      markCliFailure();
    }
  } catch (err) {
    const message = toErrorMessage(err);
    if (config.json) {
      printJson(config.onJsonError ? config.onJsonError(message) : { error: message });
    } else {
      console.error(`${config.errorPrefix}: ${message}`);
    }
    markCliFailure();
  } finally {
    scheduleMatrixJsCliExit();
  }
}

type MatrixCliBackupStatus = {
  serverVersion: string | null;
  activeVersion: string | null;
  trusted: boolean | null;
  matchesDecryptionKey: boolean | null;
  decryptionKeyCached: boolean | null;
  keyLoadAttempted: boolean;
  keyLoadError: string | null;
};

type MatrixCliVerificationStatus = {
  encryptionEnabled: boolean;
  verified: boolean;
  userId: string | null;
  deviceId: string | null;
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
  recoveryKeyStored: boolean;
  recoveryKeyCreatedAt: string | null;
  pendingVerifications: number;
};

function resolveBackupStatus(status: {
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
}): MatrixCliBackupStatus {
  return {
    serverVersion: status.backup?.serverVersion ?? status.backupVersion ?? null,
    activeVersion: status.backup?.activeVersion ?? null,
    trusted: status.backup?.trusted ?? null,
    matchesDecryptionKey: status.backup?.matchesDecryptionKey ?? null,
    decryptionKeyCached: status.backup?.decryptionKeyCached ?? null,
    keyLoadAttempted: status.backup?.keyLoadAttempted ?? false,
    keyLoadError: status.backup?.keyLoadError ?? null,
  };
}

type MatrixCliBackupIssueCode =
  | "missing-server-backup"
  | "key-load-failed"
  | "key-not-loaded"
  | "key-mismatch"
  | "untrusted-signature"
  | "inactive"
  | "indeterminate"
  | "ok";

type MatrixCliBackupIssue = {
  code: MatrixCliBackupIssueCode;
  summary: string;
  message: string | null;
};

function yesNoUnknown(value: boolean | null): string {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "unknown";
}

function printBackupStatus(backup: MatrixCliBackupStatus): void {
  console.log(`Backup server version: ${backup.serverVersion ?? "none"}`);
  console.log(`Backup active on this device: ${backup.activeVersion ?? "no"}`);
  console.log(`Backup trusted by this device: ${yesNoUnknown(backup.trusted)}`);
  console.log(`Backup matches local decryption key: ${yesNoUnknown(backup.matchesDecryptionKey)}`);
  console.log(`Backup key cached locally: ${yesNoUnknown(backup.decryptionKeyCached)}`);
  console.log(`Backup key load attempted: ${yesNoUnknown(backup.keyLoadAttempted)}`);
  if (backup.keyLoadError) {
    console.log(`Backup key load error: ${backup.keyLoadError}`);
  }
}

function printVerificationIdentity(status: {
  userId: string | null;
  deviceId: string | null;
}): void {
  console.log(`User: ${status.userId ?? "unknown"}`);
  console.log(`Device: ${status.deviceId ?? "unknown"}`);
}

function printVerificationBackupSummary(status: {
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
}): void {
  printBackupSummary(resolveBackupStatus(status));
}

function printVerificationBackupStatus(status: {
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
}): void {
  printBackupStatus(resolveBackupStatus(status));
}

function printVerificationGuidance(status: MatrixCliVerificationStatus): void {
  printGuidance(buildVerificationGuidance(status));
}

function resolveBackupIssue(backup: MatrixCliBackupStatus): MatrixCliBackupIssue {
  if (!backup.serverVersion) {
    return {
      code: "missing-server-backup",
      summary: "missing on server",
      message: "no room-key backup exists on the homeserver",
    };
  }
  if (backup.decryptionKeyCached === false) {
    if (backup.keyLoadError) {
      return {
        code: "key-load-failed",
        summary: "present but backup key unavailable on this device",
        message: `backup decryption key could not be loaded from secret storage (${backup.keyLoadError})`,
      };
    }
    if (backup.keyLoadAttempted) {
      return {
        code: "key-not-loaded",
        summary: "present but backup key unavailable on this device",
        message:
          "backup decryption key is not loaded on this device (secret storage did not return a key)",
      };
    }
    return {
      code: "key-not-loaded",
      summary: "present but backup key unavailable on this device",
      message: "backup decryption key is not loaded on this device",
    };
  }
  if (backup.matchesDecryptionKey === false) {
    return {
      code: "key-mismatch",
      summary: "present but backup key mismatch on this device",
      message: "backup key mismatch (this device does not have the matching backup decryption key)",
    };
  }
  if (backup.trusted === false) {
    return {
      code: "untrusted-signature",
      summary: "present but not trusted on this device",
      message: "backup signature chain is not trusted by this device",
    };
  }
  if (!backup.activeVersion) {
    return {
      code: "inactive",
      summary: "present on server but inactive on this device",
      message: "backup exists but is not active on this device",
    };
  }
  if (
    backup.trusted === null ||
    backup.matchesDecryptionKey === null ||
    backup.decryptionKeyCached === null
  ) {
    return {
      code: "indeterminate",
      summary: "present but trust state unknown",
      message: "backup trust state could not be fully determined",
    };
  }
  return {
    code: "ok",
    summary: "active and trusted on this device",
    message: null,
  };
}

function printBackupSummary(backup: MatrixCliBackupStatus): void {
  const issue = resolveBackupIssue(backup);
  console.log(`Backup: ${issue.summary}`);
  if (backup.serverVersion) {
    console.log(`Backup version: ${backup.serverVersion}`);
  }
}

function buildVerificationGuidance(status: MatrixCliVerificationStatus): string[] {
  const backup = resolveBackupStatus(status);
  const backupIssue = resolveBackupIssue(backup);
  const nextSteps = new Set<string>();
  if (!status.verified) {
    nextSteps.add("Run 'openclaw matrix-js verify device <key>' to verify this device.");
  }
  if (backupIssue.code === "missing-server-backup") {
    nextSteps.add("Run 'openclaw matrix-js verify bootstrap' to create a room key backup.");
  } else if (
    backupIssue.code === "key-load-failed" ||
    backupIssue.code === "key-not-loaded" ||
    backupIssue.code === "inactive"
  ) {
    if (status.recoveryKeyStored) {
      nextSteps.add(
        "Backup key is not loaded on this device. Run 'openclaw matrix-js verify backup restore' to load it and restore old room keys.",
      );
    } else {
      nextSteps.add(
        "Store a recovery key with 'openclaw matrix-js verify device <key>', then run 'openclaw matrix-js verify backup restore'.",
      );
    }
  } else if (backupIssue.code === "key-mismatch") {
    nextSteps.add(
      "Backup key mismatch on this device. Re-run 'openclaw matrix-js verify device <key>' with the matching recovery key.",
    );
  } else if (backupIssue.code === "untrusted-signature") {
    nextSteps.add(
      "Backup trust chain is not verified on this device. Re-run 'openclaw matrix-js verify device <key>'.",
    );
  } else if (backupIssue.code === "indeterminate") {
    nextSteps.add(
      "Run 'openclaw matrix-js verify status --verbose' to inspect backup trust diagnostics.",
    );
  }
  if (status.pendingVerifications > 0) {
    nextSteps.add(`Complete ${status.pendingVerifications} pending verification request(s).`);
  }
  return Array.from(nextSteps);
}

function printGuidance(lines: string[]): void {
  if (lines.length === 0) {
    return;
  }
  console.log("Next steps:");
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

function printVerificationStatus(status: MatrixCliVerificationStatus, verbose = false): void {
  console.log(`Verified: ${status.verified ? "yes" : "no"}`);
  const backup = resolveBackupStatus(status);
  const backupIssue = resolveBackupIssue(backup);
  printVerificationBackupSummary(status);
  if (backupIssue.message) {
    console.log(`Backup issue: ${backupIssue.message}`);
  }
  if (verbose) {
    console.log("Diagnostics:");
    printVerificationIdentity(status);
    printVerificationBackupStatus(status);
    console.log(`Recovery key stored: ${status.recoveryKeyStored ? "yes" : "no"}`);
    printTimestamp("Recovery key created at", status.recoveryKeyCreatedAt);
    console.log(`Pending verifications: ${status.pendingVerifications}`);
  } else {
    console.log(`Recovery key stored: ${status.recoveryKeyStored ? "yes" : "no"}`);
  }
  printVerificationGuidance(status);
}

export function registerMatrixJsCli(params: { program: Command }): void {
  const root = params.program
    .command("matrix-js")
    .description("Matrix-js channel utilities")
    .addHelpText("after", () => "\nDocs: https://docs.openclaw.ai/channels/matrix-js\n");

  const account = root.command("account").description("Manage matrix-js channel accounts");

  account
    .command("add")
    .description("Add or update a matrix-js account (wrapper around channel setup)")
    .option("--account <id>", "Account ID (default: normalized --name, else default)")
    .option("--name <name>", "Optional display name for this account")
    .option("--avatar-url <url>", "Optional Matrix avatar URL (mxc:// or http(s) URL)")
    .option("--homeserver <url>", "Matrix homeserver URL")
    .option("--user-id <id>", "Matrix user ID")
    .option("--access-token <token>", "Matrix access token")
    .option("--password <password>", "Matrix password")
    .option("--device-name <name>", "Matrix device display name")
    .option("--initial-sync-limit <n>", "Matrix initial sync limit")
    .option(
      "--use-env",
      "Use MATRIX_* env vars (or MATRIX_<ACCOUNT_ID>_* for non-default accounts)",
    )
    .option("--verbose", "Show setup details")
    .option("--json", "Output as JSON")
    .action(
      async (options: {
        account?: string;
        name?: string;
        avatarUrl?: string;
        homeserver?: string;
        userId?: string;
        accessToken?: string;
        password?: string;
        deviceName?: string;
        initialSyncLimit?: string;
        useEnv?: boolean;
        verbose?: boolean;
        json?: boolean;
      }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await addMatrixJsAccount({
              account: options.account,
              name: options.name,
              avatarUrl: options.avatarUrl,
              homeserver: options.homeserver,
              userId: options.userId,
              accessToken: options.accessToken,
              password: options.password,
              deviceName: options.deviceName,
              initialSyncLimit: options.initialSyncLimit,
              useEnv: options.useEnv === true,
            }),
          onText: (result) => {
            console.log(`Saved matrix-js account: ${result.accountId}`);
            console.log(`Config path: ${result.configPath}`);
            console.log(
              `Credentials source: ${result.useEnv ? "MATRIX_* / MATRIX_<ACCOUNT_ID>_* env vars" : "inline config"}`,
            );
            if (result.profile.attempted) {
              if (result.profile.error) {
                console.error(`Profile sync warning: ${result.profile.error}`);
              } else {
                console.log(
                  `Profile sync: name ${result.profile.displayNameUpdated ? "updated" : "unchanged"}, avatar ${result.profile.avatarUpdated ? "updated" : "unchanged"}`,
                );
                if (result.profile.convertedAvatarFromHttp && result.profile.resolvedAvatarUrl) {
                  console.log(`Avatar converted and saved as: ${result.profile.resolvedAvatarUrl}`);
                }
              }
            }
            const bindHint = `openclaw agents bind --agent <id> --bind matrix-js:${result.accountId}`;
            console.log(`Bind this account to an agent: ${bindHint}`);
          },
          errorPrefix: "Account setup failed",
        });
      },
    );

  const profile = root.command("profile").description("Manage Matrix-js bot profile");

  profile
    .command("set")
    .description("Update Matrix profile display name and/or avatar")
    .option("--account <id>", "Account ID (for multi-account setups)")
    .option("--name <name>", "Profile display name")
    .option("--avatar-url <url>", "Profile avatar URL (mxc:// or http(s) URL)")
    .option("--verbose", "Show detailed diagnostics")
    .option("--json", "Output as JSON")
    .action(
      async (options: {
        account?: string;
        name?: string;
        avatarUrl?: string;
        verbose?: boolean;
        json?: boolean;
      }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await setMatrixJsProfile({
              account: options.account,
              name: options.name,
              avatarUrl: options.avatarUrl,
            }),
          onText: (result) => {
            printAccountLabel(result.accountId);
            console.log(`Config path: ${result.configPath}`);
            console.log(
              `Profile update: name ${result.profile.displayNameUpdated ? "updated" : "unchanged"}, avatar ${result.profile.avatarUpdated ? "updated" : "unchanged"}`,
            );
            if (result.profile.convertedAvatarFromHttp && result.avatarUrl) {
              console.log(`Avatar converted and saved as: ${result.avatarUrl}`);
            }
          },
          errorPrefix: "Profile update failed",
        });
      },
    );

  const verify = root.command("verify").description("Device verification for Matrix E2EE");

  verify
    .command("status")
    .description("Check Matrix-js device verification status")
    .option("--account <id>", "Account ID (for multi-account setups)")
    .option("--verbose", "Show detailed diagnostics")
    .option("--include-recovery-key", "Include stored recovery key in output")
    .option("--json", "Output as JSON")
    .action(
      async (options: {
        account?: string;
        verbose?: boolean;
        includeRecoveryKey?: boolean;
        json?: boolean;
      }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await getMatrixVerificationStatus({
              accountId: options.account,
              includeRecoveryKey: options.includeRecoveryKey === true,
            }),
          onText: (status, verbose) => {
            printAccountLabel(options.account);
            printVerificationStatus(status, verbose);
          },
          errorPrefix: "Error",
        });
      },
    );

  const backup = verify.command("backup").description("Matrix room-key backup health and restore");

  backup
    .command("status")
    .description("Show Matrix room-key backup status for this device")
    .option("--account <id>", "Account ID (for multi-account setups)")
    .option("--verbose", "Show detailed diagnostics")
    .option("--json", "Output as JSON")
    .action(async (options: { account?: string; verbose?: boolean; json?: boolean }) => {
      await runMatrixCliCommand({
        verbose: options.verbose === true,
        json: options.json === true,
        run: async () => await getMatrixRoomKeyBackupStatus({ accountId: options.account }),
        onText: (status, verbose) => {
          printAccountLabel(options.account);
          printBackupSummary(status);
          if (verbose) {
            printBackupStatus(status);
          }
        },
        errorPrefix: "Backup status failed",
      });
    });

  backup
    .command("restore")
    .description("Restore encrypted room keys from server backup")
    .option("--account <id>", "Account ID (for multi-account setups)")
    .option("--recovery-key <key>", "Optional recovery key to load before restoring")
    .option("--verbose", "Show detailed diagnostics")
    .option("--json", "Output as JSON")
    .action(
      async (options: {
        account?: string;
        recoveryKey?: string;
        verbose?: boolean;
        json?: boolean;
      }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await restoreMatrixRoomKeyBackup({
              accountId: options.account,
              recoveryKey: options.recoveryKey,
            }),
          onText: (result, verbose) => {
            printAccountLabel(options.account);
            console.log(`Restore success: ${result.success ? "yes" : "no"}`);
            if (result.error) {
              console.log(`Error: ${result.error}`);
            }
            console.log(`Backup version: ${result.backupVersion ?? "none"}`);
            console.log(`Imported keys: ${result.imported}/${result.total}`);
            printBackupSummary(result.backup);
            if (verbose) {
              console.log(
                `Loaded key from secret storage: ${result.loadedFromSecretStorage ? "yes" : "no"}`,
              );
              printTimestamp("Restored at", result.restoredAt);
              printBackupStatus(result.backup);
            }
          },
          shouldFail: (result) => !result.success,
          errorPrefix: "Backup restore failed",
          onJsonError: (message) => ({ success: false, error: message }),
        });
      },
    );

  verify
    .command("bootstrap")
    .description("Bootstrap Matrix-js cross-signing and device verification state")
    .option("--account <id>", "Account ID (for multi-account setups)")
    .option("--recovery-key <key>", "Recovery key to apply before bootstrap")
    .option("--force-reset-cross-signing", "Force reset cross-signing identity before bootstrap")
    .option("--verbose", "Show detailed diagnostics")
    .option("--json", "Output as JSON")
    .action(
      async (options: {
        account?: string;
        recoveryKey?: string;
        forceResetCrossSigning?: boolean;
        verbose?: boolean;
        json?: boolean;
      }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await bootstrapMatrixVerification({
              accountId: options.account,
              recoveryKey: options.recoveryKey,
              forceResetCrossSigning: options.forceResetCrossSigning === true,
            }),
          onText: (result, verbose) => {
            printAccountLabel(options.account);
            console.log(`Bootstrap success: ${result.success ? "yes" : "no"}`);
            if (result.error) {
              console.log(`Error: ${result.error}`);
            }
            console.log(`Verified: ${result.verification.verified ? "yes" : "no"}`);
            printVerificationIdentity(result.verification);
            if (verbose) {
              console.log(
                `Cross-signing published: ${result.crossSigning.published ? "yes" : "no"} (master=${result.crossSigning.masterKeyPublished ? "yes" : "no"}, self=${result.crossSigning.selfSigningKeyPublished ? "yes" : "no"}, user=${result.crossSigning.userSigningKeyPublished ? "yes" : "no"})`,
              );
              printVerificationBackupStatus(result.verification);
              printTimestamp("Recovery key created at", result.verification.recoveryKeyCreatedAt);
              console.log(`Pending verifications: ${result.pendingVerifications}`);
            } else {
              console.log(
                `Cross-signing published: ${result.crossSigning.published ? "yes" : "no"}`,
              );
              printVerificationBackupSummary(result.verification);
            }
            printVerificationGuidance({
              ...result.verification,
              pendingVerifications: result.pendingVerifications,
            });
          },
          shouldFail: (result) => !result.success,
          errorPrefix: "Verification bootstrap failed",
          onJsonError: (message) => ({ success: false, error: message }),
        });
      },
    );

  verify
    .command("device <key>")
    .description("Verify device using a Matrix recovery key")
    .option("--account <id>", "Account ID (for multi-account setups)")
    .option("--verbose", "Show detailed diagnostics")
    .option("--json", "Output as JSON")
    .action(
      async (key: string, options: { account?: string; verbose?: boolean; json?: boolean }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () => await verifyMatrixRecoveryKey(key, { accountId: options.account }),
          onText: (result, verbose) => {
            printAccountLabel(options.account);
            if (!result.success) {
              console.error(`Verification failed: ${result.error ?? "unknown error"}`);
              return;
            }
            console.log("Device verification completed successfully.");
            printVerificationIdentity(result);
            printVerificationBackupSummary(result);
            if (verbose) {
              printVerificationBackupStatus(result);
              printTimestamp("Recovery key created at", result.recoveryKeyCreatedAt);
              printTimestamp("Verified at", result.verifiedAt);
            }
            printVerificationGuidance({
              ...result,
              pendingVerifications: 0,
            });
          },
          shouldFail: (result) => !result.success,
          errorPrefix: "Verification failed",
          onJsonError: (message) => ({ success: false, error: message }),
        });
      },
    );
}
