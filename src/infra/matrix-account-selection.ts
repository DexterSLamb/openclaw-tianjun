import type { OpenClawConfig } from "../config/config.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "../routing/session-key.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveMatrixChannelConfig(cfg: OpenClawConfig): Record<string, unknown> | null {
  return isRecord(cfg.channels?.matrix) ? cfg.channels.matrix : null;
}

export function resolveConfiguredMatrixAccountIds(cfg: OpenClawConfig): string[] {
  const channel = resolveMatrixChannelConfig(cfg);
  if (!channel) {
    return [];
  }

  const accounts = isRecord(channel.accounts) ? channel.accounts : null;
  if (!accounts) {
    return [DEFAULT_ACCOUNT_ID];
  }

  const ids = Object.keys(accounts)
    .map((accountId) => normalizeAccountId(accountId))
    .filter((accountId) => accountId.length > 0 && isRecord(accounts[accountId]));

  return Array.from(new Set(ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID])).toSorted((a, b) =>
    a.localeCompare(b),
  );
}

export function resolveMatrixDefaultOrOnlyAccountId(cfg: OpenClawConfig): string {
  const channel = resolveMatrixChannelConfig(cfg);
  if (!channel) {
    return DEFAULT_ACCOUNT_ID;
  }

  const accounts = isRecord(channel.accounts) ? channel.accounts : null;
  const configuredDefault = normalizeOptionalAccountId(
    typeof channel.defaultAccount === "string" ? channel.defaultAccount : undefined,
  );
  if (configuredDefault && accounts && isRecord(accounts[configuredDefault])) {
    return configuredDefault;
  }
  if (accounts && isRecord(accounts[DEFAULT_ACCOUNT_ID])) {
    return DEFAULT_ACCOUNT_ID;
  }

  const configuredAccountIds = resolveConfiguredMatrixAccountIds(cfg);
  if (configuredAccountIds.length === 1) {
    return configuredAccountIds[0] ?? DEFAULT_ACCOUNT_ID;
  }
  return DEFAULT_ACCOUNT_ID;
}
