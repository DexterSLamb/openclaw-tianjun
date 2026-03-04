import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleMatrixAction } from "./tool-actions.js";
import type { CoreConfig } from "./types.js";

const mocks = vi.hoisted(() => ({
  voteMatrixPoll: vi.fn(),
  reactMatrixMessage: vi.fn(),
}));

vi.mock("./matrix/actions.js", async () => {
  const actual = await vi.importActual<typeof import("./matrix/actions.js")>("./matrix/actions.js");
  return {
    ...actual,
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
});
