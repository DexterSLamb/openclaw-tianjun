import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleMatrixAction } from "./tool-actions.js";
import type { CoreConfig } from "./types.js";

const mocks = vi.hoisted(() => ({
  voteMatrixPoll: vi.fn(),
  reactMatrixMessage: vi.fn(),
  listMatrixReactions: vi.fn(),
  removeMatrixReactions: vi.fn(),
  sendMatrixMessage: vi.fn(),
  listMatrixPins: vi.fn(),
  getMatrixMemberInfo: vi.fn(),
  getMatrixRoomInfo: vi.fn(),
  applyMatrixProfileUpdate: vi.fn(),
}));

vi.mock("./matrix/actions.js", async () => {
  const actual = await vi.importActual<typeof import("./matrix/actions.js")>("./matrix/actions.js");
  return {
    ...actual,
    getMatrixMemberInfo: mocks.getMatrixMemberInfo,
    getMatrixRoomInfo: mocks.getMatrixRoomInfo,
    listMatrixReactions: mocks.listMatrixReactions,
    listMatrixPins: mocks.listMatrixPins,
    removeMatrixReactions: mocks.removeMatrixReactions,
    sendMatrixMessage: mocks.sendMatrixMessage,
    voteMatrixPoll: mocks.voteMatrixPoll,
  };
});

vi.mock("./matrix/send.js", async () => {
  const actual = await vi.importActual<typeof import("./matrix/send.js")>("./matrix/send.js");
  return {
    ...actual,
    reactMatrixMessage: mocks.reactMatrixMessage,
  };
});

vi.mock("./profile-update.js", () => ({
  applyMatrixProfileUpdate: (...args: unknown[]) => mocks.applyMatrixProfileUpdate(...args),
}));

describe("handleMatrixAction pollVote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.voteMatrixPoll.mockResolvedValue({
      eventId: "evt-poll-vote",
      roomId: "!room:example",
      pollId: "$poll",
      answerIds: ["a1", "a2"],
      labels: ["Pizza", "Sushi"],
      maxSelections: 2,
    });
    mocks.listMatrixReactions.mockResolvedValue([{ key: "👍", count: 1, users: ["@u:example"] }]);
    mocks.listMatrixPins.mockResolvedValue({ pinned: ["$pin"], events: [] });
    mocks.removeMatrixReactions.mockResolvedValue({ removed: 1 });
    mocks.sendMatrixMessage.mockResolvedValue({
      messageId: "$sent",
      roomId: "!room:example",
    });
    mocks.getMatrixMemberInfo.mockResolvedValue({ userId: "@u:example" });
    mocks.getMatrixRoomInfo.mockResolvedValue({ roomId: "!room:example" });
    mocks.applyMatrixProfileUpdate.mockResolvedValue({
      accountId: "ops",
      displayName: "Ops Bot",
      avatarUrl: "mxc://example/avatar",
      profile: {
        displayNameUpdated: true,
        avatarUpdated: true,
        resolvedAvatarUrl: "mxc://example/avatar",
        convertedAvatarFromHttp: false,
      },
      configPath: "channels.matrix.accounts.ops",
    });
  });

  it("parses snake_case vote params and forwards normalized selectors", async () => {
    const result = await handleMatrixAction(
      {
        action: "pollVote",
        account_id: "main",
        room_id: "!room:example",
        poll_id: "$poll",
        poll_option_id: "a1",
        poll_option_ids: ["a2", ""],
        poll_option_index: "2",
        poll_option_indexes: ["1", "bogus"],
      },
      {} as CoreConfig,
    );

    expect(mocks.voteMatrixPoll).toHaveBeenCalledWith("!room:example", "$poll", {
      accountId: "main",
      optionIds: ["a2", "a1"],
      optionIndexes: [1, 2],
    });
    expect(result.details).toMatchObject({
      ok: true,
      result: {
        eventId: "evt-poll-vote",
        answerIds: ["a1", "a2"],
      },
    });
  });

  it("rejects missing poll ids", async () => {
    await expect(
      handleMatrixAction(
        {
          action: "pollVote",
          roomId: "!room:example",
          pollOptionIndex: 1,
        },
        {} as CoreConfig,
      ),
    ).rejects.toThrow("pollId required");
  });

  it("passes account-scoped opts to add reactions", async () => {
    await handleMatrixAction(
      {
        action: "react",
        accountId: "ops",
        roomId: "!room:example",
        messageId: "$msg",
        emoji: "👍",
      },
      { channels: { matrix: { actions: { reactions: true } } } } as CoreConfig,
    );

    expect(mocks.reactMatrixMessage).toHaveBeenCalledWith("!room:example", "$msg", "👍", {
      accountId: "ops",
    });
  });

  it("passes account-scoped opts to remove reactions", async () => {
    await handleMatrixAction(
      {
        action: "react",
        account_id: "ops",
        room_id: "!room:example",
        message_id: "$msg",
        emoji: "👍",
        remove: true,
      },
      { channels: { matrix: { actions: { reactions: true } } } } as CoreConfig,
    );

    expect(mocks.removeMatrixReactions).toHaveBeenCalledWith("!room:example", "$msg", {
      accountId: "ops",
      emoji: "👍",
    });
  });

  it("passes account-scoped opts and limit to reaction listing", async () => {
    const result = await handleMatrixAction(
      {
        action: "reactions",
        account_id: "ops",
        room_id: "!room:example",
        message_id: "$msg",
        limit: "5",
      },
      { channels: { matrix: { actions: { reactions: true } } } } as CoreConfig,
    );

    expect(mocks.listMatrixReactions).toHaveBeenCalledWith("!room:example", "$msg", {
      accountId: "ops",
      limit: 5,
    });
    expect(result.details).toMatchObject({
      ok: true,
      reactions: [{ key: "👍", count: 1 }],
    });
  });

  it("passes account-scoped opts to message sends", async () => {
    await handleMatrixAction(
      {
        action: "sendMessage",
        accountId: "ops",
        to: "room:!room:example",
        content: "hello",
        threadId: "$thread",
      },
      { channels: { matrix: { actions: { messages: true } } } } as CoreConfig,
    );

    expect(mocks.sendMatrixMessage).toHaveBeenCalledWith("room:!room:example", "hello", {
      accountId: "ops",
      mediaUrl: undefined,
      replyToId: undefined,
      threadId: "$thread",
    });
  });

  it("passes account-scoped opts to pin listing", async () => {
    await handleMatrixAction(
      {
        action: "listPins",
        accountId: "ops",
        roomId: "!room:example",
      },
      { channels: { matrix: { actions: { pins: true } } } } as CoreConfig,
    );

    expect(mocks.listMatrixPins).toHaveBeenCalledWith("!room:example", {
      accountId: "ops",
    });
  });

  it("passes account-scoped opts to member and room info actions", async () => {
    await handleMatrixAction(
      {
        action: "memberInfo",
        accountId: "ops",
        userId: "@u:example",
        roomId: "!room:example",
      },
      { channels: { matrix: { actions: { memberInfo: true } } } } as CoreConfig,
    );
    await handleMatrixAction(
      {
        action: "channelInfo",
        accountId: "ops",
        roomId: "!room:example",
      },
      { channels: { matrix: { actions: { channelInfo: true } } } } as CoreConfig,
    );

    expect(mocks.getMatrixMemberInfo).toHaveBeenCalledWith("@u:example", {
      accountId: "ops",
      roomId: "!room:example",
    });
    expect(mocks.getMatrixRoomInfo).toHaveBeenCalledWith("!room:example", {
      accountId: "ops",
    });
  });

  it("persists self-profile updates through the shared profile helper", async () => {
    const result = await handleMatrixAction(
      {
        action: "setProfile",
        account_id: "ops",
        display_name: "Ops Bot",
        avatar_url: "mxc://example/avatar",
      },
      { channels: { matrix: { actions: { profile: true } } } } as CoreConfig,
    );

    expect(mocks.applyMatrixProfileUpdate).toHaveBeenCalledWith({
      account: "ops",
      displayName: "Ops Bot",
      avatarUrl: "mxc://example/avatar",
    });
    expect(result.details).toMatchObject({
      ok: true,
      accountId: "ops",
      profile: {
        displayNameUpdated: true,
        avatarUpdated: true,
      },
    });
  });
});
