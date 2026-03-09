import { describe, expect, it, vi } from "vitest";
import {
  isSupportedMatrixAvatarSource,
  syncMatrixOwnProfile,
  type MatrixProfileSyncResult,
} from "./profile.js";

function createClientStub() {
  return {
    getUserProfile: vi.fn(async () => ({})),
    setDisplayName: vi.fn(async () => {}),
    setAvatarUrl: vi.fn(async () => {}),
    uploadContent: vi.fn(async () => "mxc://example/avatar"),
  };
}

function expectNoUpdates(result: MatrixProfileSyncResult) {
  expect(result.displayNameUpdated).toBe(false);
  expect(result.avatarUpdated).toBe(false);
}

describe("matrix profile sync", () => {
  it("skips when no desired profile values are provided", async () => {
    const client = createClientStub();
    const result = await syncMatrixOwnProfile({
      client,
      userId: "@bot:example.org",
    });

    expect(result.skipped).toBe(true);
    expectNoUpdates(result);
    expect(client.setDisplayName).not.toHaveBeenCalled();
    expect(client.setAvatarUrl).not.toHaveBeenCalled();
  });

  it("updates display name when desired name differs", async () => {
    const client = createClientStub();
    client.getUserProfile.mockResolvedValue({
      displayname: "Old Name",
      avatar_url: "mxc://example/existing",
    });

    const result = await syncMatrixOwnProfile({
      client,
      userId: "@bot:example.org",
      displayName: "New Name",
    });

    expect(result.skipped).toBe(false);
    expect(result.displayNameUpdated).toBe(true);
    expect(result.avatarUpdated).toBe(false);
    expect(client.setDisplayName).toHaveBeenCalledWith("New Name");
  });

  it("does not update when name and avatar already match", async () => {
    const client = createClientStub();
    client.getUserProfile.mockResolvedValue({
      displayname: "Bot",
      avatar_url: "mxc://example/avatar",
    });

    const result = await syncMatrixOwnProfile({
      client,
      userId: "@bot:example.org",
      displayName: "Bot",
      avatarUrl: "mxc://example/avatar",
    });

    expect(result.skipped).toBe(false);
    expectNoUpdates(result);
    expect(client.setDisplayName).not.toHaveBeenCalled();
    expect(client.setAvatarUrl).not.toHaveBeenCalled();
  });

  it("converts http avatar URL by uploading and then updates profile avatar", async () => {
    const client = createClientStub();
    client.getUserProfile.mockResolvedValue({
      displayname: "Bot",
      avatar_url: "mxc://example/old",
    });
    client.uploadContent.mockResolvedValue("mxc://example/new-avatar");
    const loadAvatarFromUrl = vi.fn(async () => ({
      buffer: Buffer.from("avatar-bytes"),
      contentType: "image/png",
      fileName: "avatar.png",
    }));

    const result = await syncMatrixOwnProfile({
      client,
      userId: "@bot:example.org",
      avatarUrl: "https://cdn.example.org/avatar.png",
      loadAvatarFromUrl,
    });

    expect(result.convertedAvatarFromHttp).toBe(true);
    expect(result.resolvedAvatarUrl).toBe("mxc://example/new-avatar");
    expect(result.avatarUpdated).toBe(true);
    expect(loadAvatarFromUrl).toHaveBeenCalledWith(
      "https://cdn.example.org/avatar.png",
      10 * 1024 * 1024,
    );
    expect(client.setAvatarUrl).toHaveBeenCalledWith("mxc://example/new-avatar");
  });

  it("rejects unsupported avatar URL schemes", async () => {
    const client = createClientStub();

    await expect(
      syncMatrixOwnProfile({
        client,
        userId: "@bot:example.org",
        avatarUrl: "file:///tmp/avatar.png",
      }),
    ).rejects.toThrow("Matrix avatar URL must be an mxc:// URI or an http(s) URL.");
  });

  it("recognizes supported avatar sources", () => {
    expect(isSupportedMatrixAvatarSource("mxc://example/avatar")).toBe(true);
    expect(isSupportedMatrixAvatarSource("https://example.org/avatar.png")).toBe(true);
    expect(isSupportedMatrixAvatarSource("http://example.org/avatar.png")).toBe(true);
    expect(isSupportedMatrixAvatarSource("ftp://example.org/avatar.png")).toBe(false);
  });
});
