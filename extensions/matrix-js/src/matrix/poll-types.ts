/**
 * Matrix Poll Types (MSC3381)
 *
 * Defines types for Matrix poll events:
 * - m.poll.start - Creates a new poll
 * - m.poll.response - Records a vote
 * - m.poll.end - Closes a poll
 */

import { normalizePollInput, type PollInput } from "openclaw/plugin-sdk/matrix-js";

export const M_POLL_START = "m.poll.start" as const;
export const M_POLL_RESPONSE = "m.poll.response" as const;
export const M_POLL_END = "m.poll.end" as const;

export const ORG_POLL_START = "org.matrix.msc3381.poll.start" as const;
export const ORG_POLL_RESPONSE = "org.matrix.msc3381.poll.response" as const;
export const ORG_POLL_END = "org.matrix.msc3381.poll.end" as const;

export const POLL_EVENT_TYPES = [
  M_POLL_START,
  M_POLL_RESPONSE,
  M_POLL_END,
  ORG_POLL_START,
  ORG_POLL_RESPONSE,
  ORG_POLL_END,
];

export const POLL_START_TYPES = [M_POLL_START, ORG_POLL_START];
export const POLL_RESPONSE_TYPES = [M_POLL_RESPONSE, ORG_POLL_RESPONSE];
export const POLL_END_TYPES = [M_POLL_END, ORG_POLL_END];

export type PollKind = "m.poll.disclosed" | "m.poll.undisclosed";

export type TextContent = {
  "m.text"?: string;
  "org.matrix.msc1767.text"?: string;
  body?: string;
};

export type PollAnswer = {
  id: string;
} & TextContent;

export type PollParsedAnswer = {
  id: string;
  text: string;
};

export type PollStartSubtype = {
  question: TextContent;
  kind?: PollKind;
  max_selections?: number;
  answers: PollAnswer[];
};

export type LegacyPollStartContent = {
  "m.poll"?: PollStartSubtype;
};

export type PollStartContent = {
  [M_POLL_START]?: PollStartSubtype;
  [ORG_POLL_START]?: PollStartSubtype;
  "m.poll"?: PollStartSubtype;
  "m.text"?: string;
  "org.matrix.msc1767.text"?: string;
};

export type PollSummary = {
  eventId: string;
  roomId: string;
  sender: string;
  senderName: string;
  question: string;
  answers: string[];
  kind: PollKind;
  maxSelections: number;
};

export type ParsedPollStart = {
  question: string;
  answers: PollParsedAnswer[];
  kind: PollKind;
  maxSelections: number;
};

export type PollResponseSubtype = {
  answers: string[];
};

export type PollResponseContent = {
  [M_POLL_RESPONSE]?: PollResponseSubtype;
  [ORG_POLL_RESPONSE]?: PollResponseSubtype;
  "m.relates_to": {
    rel_type: "m.reference";
    event_id: string;
  };
};

export function isPollStartType(eventType: string): boolean {
  return (POLL_START_TYPES as readonly string[]).includes(eventType);
}

export function getTextContent(text?: TextContent): string {
  if (!text) {
    return "";
  }
  return text["m.text"] ?? text["org.matrix.msc1767.text"] ?? text.body ?? "";
}

export function parsePollStart(content: PollStartContent): ParsedPollStart | null {
  const poll =
    (content as Record<string, PollStartSubtype | undefined>)[M_POLL_START] ??
    (content as Record<string, PollStartSubtype | undefined>)[ORG_POLL_START] ??
    (content as Record<string, PollStartSubtype | undefined>)["m.poll"];
  if (!poll) {
    return null;
  }

  const question = getTextContent(poll.question).trim();
  if (!question) {
    return null;
  }

  const answers = poll.answers
    .map((answer) => ({
      id: answer.id,
      text: getTextContent(answer).trim(),
    }))
    .filter((answer) => answer.id.trim().length > 0 && answer.text.length > 0);
  if (answers.length === 0) {
    return null;
  }

  const maxSelectionsRaw = poll.max_selections;
  const maxSelections =
    typeof maxSelectionsRaw === "number" && Number.isFinite(maxSelectionsRaw)
      ? Math.floor(maxSelectionsRaw)
      : 1;

  return {
    question,
    answers,
    kind: poll.kind ?? "m.poll.disclosed",
    maxSelections: Math.min(Math.max(maxSelections, 1), answers.length),
  };
}

export function parsePollStartContent(content: PollStartContent): PollSummary | null {
  const parsed = parsePollStart(content);
  if (!parsed) {
    return null;
  }

  return {
    eventId: "",
    roomId: "",
    sender: "",
    senderName: "",
    question: parsed.question,
    answers: parsed.answers.map((answer) => answer.text),
    kind: parsed.kind,
    maxSelections: parsed.maxSelections,
  };
}

export function formatPollAsText(summary: PollSummary): string {
  const lines = [
    "[Poll]",
    summary.question,
    "",
    ...summary.answers.map((answer, idx) => `${idx + 1}. ${answer}`),
  ];
  return lines.join("\n");
}

function buildTextContent(body: string): TextContent {
  return {
    "m.text": body,
    "org.matrix.msc1767.text": body,
  };
}

function buildPollFallbackText(question: string, answers: string[]): string {
  if (answers.length === 0) {
    return question;
  }
  return `${question}\n${answers.map((answer, idx) => `${idx + 1}. ${answer}`).join("\n")}`;
}

export function buildPollStartContent(poll: PollInput): PollStartContent {
  const normalized = normalizePollInput(poll);
  const answers = normalized.options.map((option, idx) => ({
    id: `answer${idx + 1}`,
    ...buildTextContent(option),
  }));

  const isMultiple = normalized.maxSelections > 1;
  const fallbackText = buildPollFallbackText(
    normalized.question,
    answers.map((answer) => getTextContent(answer)),
  );

  return {
    [M_POLL_START]: {
      question: buildTextContent(normalized.question),
      kind: isMultiple ? "m.poll.undisclosed" : "m.poll.disclosed",
      max_selections: normalized.maxSelections,
      answers,
    },
    "m.text": fallbackText,
    "org.matrix.msc1767.text": fallbackText,
  };
}

export function buildPollResponseContent(
  pollEventId: string,
  answerIds: string[],
): PollResponseContent {
  return {
    [M_POLL_RESPONSE]: {
      answers: answerIds,
    },
    [ORG_POLL_RESPONSE]: {
      answers: answerIds,
    },
    "m.relates_to": {
      rel_type: "m.reference",
      event_id: pollEventId,
    },
  };
}
