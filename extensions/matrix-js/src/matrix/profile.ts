import type { MatrixClient } from "./sdk.js";

export const MATRIX_PROFILE_AVATAR_MAX_BYTES = 10 * 1024 * 1024;

type MatrixProfileClient = Pick<
  MatrixClient,
  "getUserProfile" | "setDisplayName" | "setAvatarUrl" | "uploadContent"
>;

type MatrixProfileLoadResult = {
  buffer: Buffer;
  contentType?: string;
  fileName?: string;
};

export type MatrixProfileSyncResult = {
  skipped: boolean;
  displayNameUpdated: boolean;
  avatarUpdated: boolean;
  resolvedAvatarUrl: string | null;
  convertedAvatarFromHttp: boolean;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isMatrixMxcUri(value: string): boolean {
  return value.trim().toLowerCase().startsWith("mxc://");
}

export function isMatrixHttpAvatarUri(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("https://") || normalized.startsWith("http://");
}

export function isSupportedMatrixAvatarSource(value: string): boolean {
  return isMatrixMxcUri(value) || isMatrixHttpAvatarUri(value);
}

async function resolveAvatarUrl(params: {
  client: MatrixProfileClient;
  avatarUrl: string | null;
  avatarMaxBytes: number;
  loadAvatarFromUrl?: (url: string, maxBytes: number) => Promise<MatrixProfileLoadResult>;
}): Promise<{ resolvedAvatarUrl: string | null; convertedAvatarFromHttp: boolean }> {
  const avatarUrl = normalizeOptionalText(params.avatarUrl);
  if (!avatarUrl) {
    return {
      resolvedAvatarUrl: null,
      convertedAvatarFromHttp: false,
    };
  }

  if (isMatrixMxcUri(avatarUrl)) {
    return {
      resolvedAvatarUrl: avatarUrl,
      convertedAvatarFromHttp: false,
    };
  }

  if (!isMatrixHttpAvatarUri(avatarUrl)) {
    throw new Error("Matrix avatar URL must be an mxc:// URI or an http(s) URL.");
  }

  if (!params.loadAvatarFromUrl) {
    throw new Error("Matrix avatar URL conversion requires a media loader.");
  }

  const media = await params.loadAvatarFromUrl(avatarUrl, params.avatarMaxBytes);
  const uploadedMxc = await params.client.uploadContent(
    media.buffer,
    media.contentType,
    media.fileName || "avatar",
  );

  return {
    resolvedAvatarUrl: uploadedMxc,
    convertedAvatarFromHttp: true,
  };
}

export async function syncMatrixOwnProfile(params: {
  client: MatrixProfileClient;
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  avatarMaxBytes?: number;
  loadAvatarFromUrl?: (url: string, maxBytes: number) => Promise<MatrixProfileLoadResult>;
}): Promise<MatrixProfileSyncResult> {
  const desiredDisplayName = normalizeOptionalText(params.displayName);
  const avatar = await resolveAvatarUrl({
    client: params.client,
    avatarUrl: params.avatarUrl ?? null,
    avatarMaxBytes: params.avatarMaxBytes ?? MATRIX_PROFILE_AVATAR_MAX_BYTES,
    loadAvatarFromUrl: params.loadAvatarFromUrl,
  });
  const desiredAvatarUrl = avatar.resolvedAvatarUrl;

  if (!desiredDisplayName && !desiredAvatarUrl) {
    return {
      skipped: true,
      displayNameUpdated: false,
      avatarUpdated: false,
      resolvedAvatarUrl: null,
      convertedAvatarFromHttp: avatar.convertedAvatarFromHttp,
    };
  }

  let currentDisplayName: string | undefined;
  let currentAvatarUrl: string | undefined;
  try {
    const currentProfile = await params.client.getUserProfile(params.userId);
    currentDisplayName = normalizeOptionalText(currentProfile.displayname) ?? undefined;
    currentAvatarUrl = normalizeOptionalText(currentProfile.avatar_url) ?? undefined;
  } catch {
    // If profile fetch fails, attempt writes directly.
  }

  let displayNameUpdated = false;
  let avatarUpdated = false;

  if (desiredDisplayName && currentDisplayName !== desiredDisplayName) {
    await params.client.setDisplayName(desiredDisplayName);
    displayNameUpdated = true;
  }
  if (desiredAvatarUrl && currentAvatarUrl !== desiredAvatarUrl) {
    await params.client.setAvatarUrl(desiredAvatarUrl);
    avatarUpdated = true;
  }

  return {
    skipped: false,
    displayNameUpdated,
    avatarUpdated,
    resolvedAvatarUrl: desiredAvatarUrl,
    convertedAvatarFromHttp: avatar.convertedAvatarFromHttp,
  };
}
