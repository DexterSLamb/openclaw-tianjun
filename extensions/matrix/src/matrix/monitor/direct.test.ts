import { describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "../sdk.js";
import { createDirectRoomTracker } from "./direct.js";

function createMockClient(params: {
  isDm?: boolean;
  senderDirect?: boolean;
  selfDirect?: boolean;
  members?: string[];
  roomName?: string | null;
  roomNameError?: unknown;
}) {
  const members = params.members ?? ["@alice:example.org", "@bot:example.org"];
  return {
    dms: {
      update: vi.fn().mockResolvedValue(undefined),
      isDm: vi.fn().mockReturnValue(params.isDm === true),
    },
    getUserId: vi.fn().mockResolvedValue("@bot:example.org"),
    getJoinedRoomMembers: vi.fn().mockResolvedValue(members),
    getRoomStateEvent: vi
      .fn()
      .mockImplementation(async (_roomId: string, eventType: string, stateKey: string) => {
        if (eventType === "m.room.name") {
          if (params.roomNameError) {
            throw params.roomNameError;
          }
          return params.roomName == null ? {} : { name: params.roomName };
        }
        if (stateKey === "@alice:example.org") {
          return { is_direct: params.senderDirect === true };
        }
        if (stateKey === "@bot:example.org") {
          return { is_direct: params.selfDirect === true };
        }
        return {};
      }),
  } as unknown as MatrixClient;
}

describe("createDirectRoomTracker", () => {
  it("treats m.direct rooms as DMs", async () => {
    const tracker = createDirectRoomTracker(createMockClient({ isDm: true }));
    await expect(
      tracker.isDirectMessage({
        roomId: "!room:example.org",
        senderId: "@alice:example.org",
      }),
    ).resolves.toBe(true);
  });

  it("classifies 2-member rooms as DMs when direct metadata is missing", async () => {
    const client = createMockClient({ isDm: false });
    const tracker = createDirectRoomTracker(client);
    await expect(
      tracker.isDirectMessage({
        roomId: "!room:example.org",
        senderId: "@alice:example.org",
      }),
    ).resolves.toBe(true);
    expect(client.getJoinedRoomMembers).toHaveBeenCalledWith("!room:example.org");
  });

  it("does not classify named 2-member rooms as DMs from member count alone", async () => {
    const tracker = createDirectRoomTracker(createMockClient({ isDm: false, roomName: "Project" }));
    await expect(
      tracker.isDirectMessage({
        roomId: "!room:example.org",
        senderId: "@alice:example.org",
      }),
    ).resolves.toBe(false);
  });

  it("treats missing room names as DM fallback for 2-member rooms", async () => {
    const tracker = createDirectRoomTracker(
      createMockClient({
        isDm: false,
        roomNameError: { errcode: "M_NOT_FOUND" },
      }),
    );
    await expect(
      tracker.isDirectMessage({
        roomId: "!room:example.org",
        senderId: "@alice:example.org",
      }),
    ).resolves.toBe(true);
  });

  it("uses is_direct member flags when present", async () => {
    const tracker = createDirectRoomTracker(createMockClient({ senderDirect: true }));
    await expect(
      tracker.isDirectMessage({
        roomId: "!room:example.org",
        senderId: "@alice:example.org",
      }),
    ).resolves.toBe(true);
  });
});
