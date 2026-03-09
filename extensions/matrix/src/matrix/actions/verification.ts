import { withResolvedActionClient } from "./client.js";
import type { MatrixActionClientOpts } from "./types.js";

function requireCrypto(
  client: import("../sdk.js").MatrixClient,
): NonNullable<import("../sdk.js").MatrixClient["crypto"]> {
  if (!client.crypto) {
    throw new Error("Matrix encryption is not available (enable channels.matrix.encryption=true)");
  }
  return client.crypto;
}

function resolveVerificationId(input: string): string {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error("Matrix verification request id is required");
  }
  return normalized;
}

export async function listMatrixVerifications(opts: MatrixActionClientOpts = {}) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.listVerifications();
    },
    "persist",
  );
}

export async function requestMatrixVerification(
  params: MatrixActionClientOpts & {
    ownUser?: boolean;
    userId?: string;
    deviceId?: string;
    roomId?: string;
  } = {},
) {
  return await withResolvedActionClient(
    { ...params, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      const ownUser = params.ownUser ?? (!params.userId && !params.deviceId && !params.roomId);
      return await crypto.requestVerification({
        ownUser,
        userId: params.userId?.trim() || undefined,
        deviceId: params.deviceId?.trim() || undefined,
        roomId: params.roomId?.trim() || undefined,
      });
    },
    "persist",
  );
}

export async function acceptMatrixVerification(
  requestId: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.acceptVerification(resolveVerificationId(requestId));
    },
    "persist",
  );
}

export async function cancelMatrixVerification(
  requestId: string,
  opts: MatrixActionClientOpts & { reason?: string; code?: string } = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.cancelVerification(resolveVerificationId(requestId), {
        reason: opts.reason?.trim() || undefined,
        code: opts.code?.trim() || undefined,
      });
    },
    "persist",
  );
}

export async function startMatrixVerification(
  requestId: string,
  opts: MatrixActionClientOpts & { method?: "sas" } = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.startVerification(resolveVerificationId(requestId), opts.method ?? "sas");
    },
    "persist",
  );
}

export async function generateMatrixVerificationQr(
  requestId: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.generateVerificationQr(resolveVerificationId(requestId));
    },
    "persist",
  );
}

export async function scanMatrixVerificationQr(
  requestId: string,
  qrDataBase64: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      const payload = qrDataBase64.trim();
      if (!payload) {
        throw new Error("Matrix QR data is required");
      }
      return await crypto.scanVerificationQr(resolveVerificationId(requestId), payload);
    },
    "persist",
  );
}

export async function getMatrixVerificationSas(
  requestId: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.getVerificationSas(resolveVerificationId(requestId));
    },
    "persist",
  );
}

export async function confirmMatrixVerificationSas(
  requestId: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.confirmVerificationSas(resolveVerificationId(requestId));
    },
    "persist",
  );
}

export async function mismatchMatrixVerificationSas(
  requestId: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.mismatchVerificationSas(resolveVerificationId(requestId));
    },
    "persist",
  );
}

export async function confirmMatrixVerificationReciprocateQr(
  requestId: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      return await crypto.confirmVerificationReciprocateQr(resolveVerificationId(requestId));
    },
    "persist",
  );
}

export async function getMatrixEncryptionStatus(
  opts: MatrixActionClientOpts & { includeRecoveryKey?: boolean } = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const crypto = requireCrypto(client);
      const recoveryKey = await crypto.getRecoveryKey();
      return {
        encryptionEnabled: true,
        recoveryKeyStored: Boolean(recoveryKey),
        recoveryKeyCreatedAt: recoveryKey?.createdAt ?? null,
        ...(opts.includeRecoveryKey ? { recoveryKey: recoveryKey?.encodedPrivateKey ?? null } : {}),
        pendingVerifications: (await crypto.listVerifications()).length,
      };
    },
    "persist",
  );
}

export async function getMatrixVerificationStatus(
  opts: MatrixActionClientOpts & { includeRecoveryKey?: boolean } = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => {
      const status = await client.getOwnDeviceVerificationStatus();
      const payload = {
        ...status,
        pendingVerifications: client.crypto ? (await client.crypto.listVerifications()).length : 0,
      };
      if (!opts.includeRecoveryKey) {
        return payload;
      }
      const recoveryKey = client.crypto ? await client.crypto.getRecoveryKey() : null;
      return {
        ...payload,
        recoveryKey: recoveryKey?.encodedPrivateKey ?? null,
      };
    },
    "persist",
  );
}

export async function getMatrixRoomKeyBackupStatus(opts: MatrixActionClientOpts = {}) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => await client.getRoomKeyBackupStatus(),
    "persist",
  );
}

export async function verifyMatrixRecoveryKey(
  recoveryKey: string,
  opts: MatrixActionClientOpts = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) => await client.verifyWithRecoveryKey(recoveryKey),
    "persist",
  );
}

export async function restoreMatrixRoomKeyBackup(
  opts: MatrixActionClientOpts & {
    recoveryKey?: string;
  } = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) =>
      await client.restoreRoomKeyBackup({
        recoveryKey: opts.recoveryKey?.trim() || undefined,
      }),
    "persist",
  );
}

export async function bootstrapMatrixVerification(
  opts: MatrixActionClientOpts & {
    recoveryKey?: string;
    forceResetCrossSigning?: boolean;
  } = {},
) {
  return await withResolvedActionClient(
    { ...opts, readiness: "started" },
    async (client) =>
      await client.bootstrapOwnDeviceVerification({
        recoveryKey: opts.recoveryKey?.trim() || undefined,
        forceResetCrossSigning: opts.forceResetCrossSigning === true,
      }),
    "persist",
  );
}
