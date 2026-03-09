import { describe, expect, it } from "vitest";
import {
  buildPollResponseContent,
  buildPollStartContent,
  parsePollStart,
  parsePollStartContent,
} from "./poll-types.js";

describe("parsePollStartContent", () => {
  it("parses legacy m.poll payloads", () => {
    const summary = parsePollStartContent({
      "m.poll": {
        question: { "m.text": "Lunch?" },
        kind: "m.poll.disclosed",
        max_selections: 1,
        answers: [
          { id: "answer1", "m.text": "Yes" },
          { id: "answer2", "m.text": "No" },
        ],
      },
    });

    expect(summary?.question).toBe("Lunch?");
    expect(summary?.answers).toEqual(["Yes", "No"]);
  });

  it("preserves answer ids when parsing poll start content", () => {
    const parsed = parsePollStart({
      "m.poll.start": {
        question: { "m.text": "Lunch?" },
        kind: "m.poll.disclosed",
        max_selections: 1,
        answers: [
          { id: "a1", "m.text": "Yes" },
          { id: "a2", "m.text": "No" },
        ],
      },
    });

    expect(parsed).toMatchObject({
      question: "Lunch?",
      answers: [
        { id: "a1", text: "Yes" },
        { id: "a2", text: "No" },
      ],
      maxSelections: 1,
    });
  });

  it("caps invalid remote max selections to the available answer count", () => {
    const parsed = parsePollStart({
      "m.poll.start": {
        question: { "m.text": "Lunch?" },
        kind: "m.poll.undisclosed",
        max_selections: 99,
        answers: [
          { id: "a1", "m.text": "Yes" },
          { id: "a2", "m.text": "No" },
        ],
      },
    });

    expect(parsed?.maxSelections).toBe(2);
  });
});

describe("buildPollStartContent", () => {
  it("preserves the requested multiselect cap instead of widening to all answers", () => {
    const content = buildPollStartContent({
      question: "Lunch?",
      options: ["Pizza", "Sushi", "Tacos"],
      maxSelections: 2,
    });

    expect(content["m.poll.start"]?.max_selections).toBe(2);
    expect(content["m.poll.start"]?.kind).toBe("m.poll.undisclosed");
  });
});

describe("buildPollResponseContent", () => {
  it("builds a poll response payload with a reference relation", () => {
    expect(buildPollResponseContent("$poll", ["a2"])).toEqual({
      "m.poll.response": {
        answers: ["a2"],
      },
      "org.matrix.msc3381.poll.response": {
        answers: ["a2"],
      },
      "m.relates_to": {
        rel_type: "m.reference",
        event_id: "$poll",
      },
    });
  });
});
