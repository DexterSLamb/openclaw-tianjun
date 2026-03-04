import { normalizeAccountId } from "openclaw/plugin-sdk/matrix-js";
import type { CoreConfig, MatrixConfig } from "../types.js";

export type MatrixAccountPatch = {
  name?: string | null;
  enabled?: boolean;
  homeserver?: string | null;
  userId?: string | null;
  accessToken?: string | null;
  password?: string | null;
  deviceName?: string | null;
  avatarUrl?: string | null;
  encryption?: boolean | null;
  initialSyncLimit?: number | null;
};

function applyNullableStringField(
  target: Record<string, unknown>,
  key: keyof MatrixAccountPatch,
  value: string | null | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    delete target[key];
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    delete target[key];
    return;
  }
  target[key] = trimmed;
}

export function updateMatrixAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: MatrixAccountPatch,
): CoreConfig {
  const matrix = cfg.channels?.["matrix-js"] ?? {};
  const normalizedAccountId = normalizeAccountId(accountId);
  const existingAccount = (matrix.accounts?.[normalizedAccountId] ?? {}) as MatrixConfig;
  const nextAccount: Record<string, unknown> = { ...existingAccount };

  if (patch.name !== undefined) {
    if (patch.name === null) {
      delete nextAccount.name;
    } else {
      const trimmed = patch.name.trim();
      if (trimmed) {
        nextAccount.name = trimmed;
      } else {
        delete nextAccount.name;
      }
    }
  }
  if (typeof patch.enabled === "boolean") {
    nextAccount.enabled = patch.enabled;
  } else if (typeof nextAccount.enabled !== "boolean") {
    nextAccount.enabled = true;
  }

  applyNullableStringField(nextAccount, "homeserver", patch.homeserver);
  applyNullableStringField(nextAccount, "userId", patch.userId);
  applyNullableStringField(nextAccount, "accessToken", patch.accessToken);
  applyNullableStringField(nextAccount, "password", patch.password);
  applyNullableStringField(nextAccount, "deviceName", patch.deviceName);
  applyNullableStringField(nextAccount, "avatarUrl", patch.avatarUrl);

  if (patch.initialSyncLimit !== undefined) {
    if (patch.initialSyncLimit === null) {
      delete nextAccount.initialSyncLimit;
    } else {
      nextAccount.initialSyncLimit = Math.max(0, Math.floor(patch.initialSyncLimit));
    }
  }

  if (patch.encryption !== undefined) {
    if (patch.encryption === null) {
      delete nextAccount.encryption;
    } else {
      nextAccount.encryption = patch.encryption;
    }
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "matrix-js": {
        ...matrix,
        enabled: true,
        accounts: {
          ...matrix.accounts,
          [normalizedAccountId]: nextAccount as MatrixConfig,
        },
      },
    },
  };
}
