import { normalizeAccountId } from "openclaw/plugin-sdk/matrix";
import { updateMatrixOwnProfile } from "./matrix/actions/profile.js";
import { updateMatrixAccountConfig, resolveMatrixConfigPath } from "./matrix/config-update.js";
import { getMatrixRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

export type MatrixProfileUpdateResult = {
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

export async function applyMatrixProfileUpdate(params: {
  account?: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<MatrixProfileUpdateResult> {
  const runtime = getMatrixRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const accountId = normalizeAccountId(params.account);
  const displayName = params.displayName?.trim() || null;
  const avatarUrl = params.avatarUrl?.trim() || null;
  if (!displayName && !avatarUrl) {
    throw new Error("Provide name/displayName and/or avatarUrl.");
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
    configPath: resolveMatrixConfigPath(updated, accountId),
  };
}
