import type { PluginRuntime } from "openclaw/plugin-sdk/matrix";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setMatrixRuntime } from "../runtime.js";

const loadWebMediaMock = vi.fn().mockResolvedValue({
  buffer: Buffer.from("media"),
  fileName: "photo.png",
  contentType: "image/png",
  kind: "image",
});
const getImageMetadataMock = vi.fn().mockResolvedValue(null);
const resizeToJpegMock = vi.fn();

const runtimeStub = {
  config: {
    loadConfig: () => ({}),
  },
  media: {
    loadWebMedia: (...args: unknown[]) => loadWebMediaMock(...args),
    mediaKindFromMime: () => "image",
    isVoiceCompatibleAudio: () => false,
    getImageMetadata: (...args: unknown[]) => getImageMetadataMock(...args),
    resizeToJpeg: (...args: unknown[]) => resizeToJpegMock(...args),
  },
  channel: {
    text: {
      resolveTextChunkLimit: () => 4000,
      resolveChunkMode: () => "length",
      chunkMarkdownText: (text: string) => (text ? [text] : []),
      chunkMarkdownTextWithMode: (text: string) => (text ? [text] : []),
      resolveMarkdownTableMode: () => "code",
      convertMarkdownTables: (text: string) => text,
    },
  },
} as unknown as PluginRuntime;

let sendMessageMatrix: typeof import("./send.js").sendMessageMatrix;
let sendTypingMatrix: typeof import("./send.js").sendTypingMatrix;
let voteMatrixPoll: typeof import("./actions/polls.js").voteMatrixPoll;

const makeClient = () => {
  const sendMessage = vi.fn().mockResolvedValue("evt1");
  const sendEvent = vi.fn().mockResolvedValue("evt-poll-vote");
  const getEvent = vi.fn();
  const uploadContent = vi.fn().mockResolvedValue("mxc://example/file");
  const client = {
    sendMessage,
    sendEvent,
    getEvent,
    uploadContent,
    getUserId: vi.fn().mockResolvedValue("@bot:example.org"),
  } as unknown as import("./sdk.js").MatrixClient;
  return { client, sendMessage, sendEvent, getEvent, uploadContent };
};

describe("sendMessageMatrix media", () => {
  beforeAll(async () => {
    setMatrixRuntime(runtimeStub);
    ({ sendMessageMatrix } = await import("./send.js"));
    ({ sendTypingMatrix } = await import("./send.js"));
    ({ voteMatrixPoll } = await import("./actions/polls.js"));
  });

  beforeEach(() => {
    loadWebMediaMock.mockReset().mockResolvedValue({
      buffer: Buffer.from("media"),
      fileName: "photo.png",
      contentType: "image/png",
      kind: "image",
    });
    getImageMetadataMock.mockReset().mockResolvedValue(null);
    resizeToJpegMock.mockReset();
    setMatrixRuntime(runtimeStub);
  });

  it("uploads media with url payloads", async () => {
    const { client, sendMessage, uploadContent } = makeClient();

    await sendMessageMatrix("room:!room:example", "caption", {
      client,
      mediaUrl: "file:///tmp/photo.png",
    });

    const uploadArg = uploadContent.mock.calls[0]?.[0];
    expect(Buffer.isBuffer(uploadArg)).toBe(true);

    const content = sendMessage.mock.calls[0]?.[1] as {
      url?: string;
      msgtype?: string;
      format?: string;
      formatted_body?: string;
    };
    expect(content.msgtype).toBe("m.image");
    expect(content.format).toBe("org.matrix.custom.html");
    expect(content.formatted_body).toContain("caption");
    expect(content.url).toBe("mxc://example/file");
  });

  it("uploads encrypted media with file payloads", async () => {
    const { client, sendMessage, uploadContent } = makeClient();
    (client as { crypto?: object }).crypto = {
      isRoomEncrypted: vi.fn().mockResolvedValue(true),
      encryptMedia: vi.fn().mockResolvedValue({
        buffer: Buffer.from("encrypted"),
        file: {
          key: {
            kty: "oct",
            key_ops: ["encrypt", "decrypt"],
            alg: "A256CTR",
            k: "secret",
            ext: true,
          },
          iv: "iv",
          hashes: { sha256: "hash" },
          v: "v2",
        },
      }),
    };

    await sendMessageMatrix("room:!room:example", "caption", {
      client,
      mediaUrl: "file:///tmp/photo.png",
    });

    const uploadArg = uploadContent.mock.calls[0]?.[0] as Buffer | undefined;
    expect(uploadArg?.toString()).toBe("encrypted");

    const content = sendMessage.mock.calls[0]?.[1] as {
      url?: string;
      file?: { url?: string };
    };
    expect(content.url).toBeUndefined();
    expect(content.file?.url).toBe("mxc://example/file");
  });

  it("does not upload plaintext thumbnails for encrypted image sends", async () => {
    const { client, uploadContent } = makeClient();
    (client as { crypto?: object }).crypto = {
      isRoomEncrypted: vi.fn().mockResolvedValue(true),
      encryptMedia: vi.fn().mockResolvedValue({
        buffer: Buffer.from("encrypted"),
        file: {
          key: {
            kty: "oct",
            key_ops: ["encrypt", "decrypt"],
            alg: "A256CTR",
            k: "secret",
            ext: true,
          },
          iv: "iv",
          hashes: { sha256: "hash" },
          v: "v2",
        },
      }),
    };
    getImageMetadataMock
      .mockResolvedValueOnce({ width: 1600, height: 1200 })
      .mockResolvedValueOnce({ width: 800, height: 600 });
    resizeToJpegMock.mockResolvedValueOnce(Buffer.from("thumb"));

    await sendMessageMatrix("room:!room:example", "caption", {
      client,
      mediaUrl: "file:///tmp/photo.png",
    });

    expect(uploadContent).toHaveBeenCalledTimes(1);
  });

  it("uploads thumbnail metadata for unencrypted large images", async () => {
    const { client, sendMessage, uploadContent } = makeClient();
    getImageMetadataMock
      .mockResolvedValueOnce({ width: 1600, height: 1200 })
      .mockResolvedValueOnce({ width: 800, height: 600 });
    resizeToJpegMock.mockResolvedValueOnce(Buffer.from("thumb"));

    await sendMessageMatrix("room:!room:example", "caption", {
      client,
      mediaUrl: "file:///tmp/photo.png",
    });

    expect(uploadContent).toHaveBeenCalledTimes(2);
    const content = sendMessage.mock.calls[0]?.[1] as {
      info?: {
        thumbnail_url?: string;
        thumbnail_info?: {
          w?: number;
          h?: number;
          mimetype?: string;
          size?: number;
        };
      };
    };
    expect(content.info?.thumbnail_url).toBe("mxc://example/file");
    expect(content.info?.thumbnail_info).toMatchObject({
      w: 800,
      h: 600,
      mimetype: "image/jpeg",
      size: Buffer.from("thumb").byteLength,
    });
  });
});

describe("sendMessageMatrix threads", () => {
  beforeAll(async () => {
    setMatrixRuntime(runtimeStub);
    ({ sendMessageMatrix } = await import("./send.js"));
    ({ sendTypingMatrix } = await import("./send.js"));
    ({ voteMatrixPoll } = await import("./actions/polls.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setMatrixRuntime(runtimeStub);
  });

  it("includes thread relation metadata when threadId is set", async () => {
    const { client, sendMessage } = makeClient();

    await sendMessageMatrix("room:!room:example", "hello thread", {
      client,
      threadId: "$thread",
    });

    const content = sendMessage.mock.calls[0]?.[1] as {
      "m.relates_to"?: {
        rel_type?: string;
        event_id?: string;
        "m.in_reply_to"?: { event_id?: string };
      };
    };

    expect(content["m.relates_to"]).toMatchObject({
      rel_type: "m.thread",
      event_id: "$thread",
      "m.in_reply_to": { event_id: "$thread" },
    });
  });
});

describe("voteMatrixPoll", () => {
  beforeAll(async () => {
    setMatrixRuntime(runtimeStub);
    ({ voteMatrixPoll } = await import("./actions/polls.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setMatrixRuntime(runtimeStub);
  });

  it("maps 1-based option indexes to Matrix poll answer ids", async () => {
    const { client, getEvent, sendEvent } = makeClient();
    getEvent.mockResolvedValue({
      type: "m.poll.start",
      content: {
        "m.poll.start": {
          question: { "m.text": "Lunch?" },
          max_selections: 1,
          answers: [
            { id: "a1", "m.text": "Pizza" },
            { id: "a2", "m.text": "Sushi" },
          ],
        },
      },
    });

    const result = await voteMatrixPoll("room:!room:example", "$poll", {
      client,
      optionIndex: 2,
    });

    expect(sendEvent).toHaveBeenCalledWith("!room:example", "m.poll.response", {
      "m.poll.response": { answers: ["a2"] },
      "org.matrix.msc3381.poll.response": { answers: ["a2"] },
      "m.relates_to": {
        rel_type: "m.reference",
        event_id: "$poll",
      },
    });
    expect(result).toMatchObject({
      eventId: "evt-poll-vote",
      roomId: "!room:example",
      pollId: "$poll",
      answerIds: ["a2"],
      labels: ["Sushi"],
    });
  });

  it("rejects out-of-range option indexes", async () => {
    const { client, getEvent } = makeClient();
    getEvent.mockResolvedValue({
      type: "m.poll.start",
      content: {
        "m.poll.start": {
          question: { "m.text": "Lunch?" },
          max_selections: 1,
          answers: [{ id: "a1", "m.text": "Pizza" }],
        },
      },
    });

    await expect(
      voteMatrixPoll("room:!room:example", "$poll", {
        client,
        optionIndex: 2,
      }),
    ).rejects.toThrow("out of range");
  });

  it("rejects votes that exceed the poll selection cap", async () => {
    const { client, getEvent } = makeClient();
    getEvent.mockResolvedValue({
      type: "m.poll.start",
      content: {
        "m.poll.start": {
          question: { "m.text": "Lunch?" },
          max_selections: 1,
          answers: [
            { id: "a1", "m.text": "Pizza" },
            { id: "a2", "m.text": "Sushi" },
          ],
        },
      },
    });

    await expect(
      voteMatrixPoll("room:!room:example", "$poll", {
        client,
        optionIndexes: [1, 2],
      }),
    ).rejects.toThrow("at most 1 selection");
  });

  it("rejects non-poll events before sending a response", async () => {
    const { client, getEvent, sendEvent } = makeClient();
    getEvent.mockResolvedValue({
      type: "m.room.message",
      content: { body: "hello" },
    });

    await expect(
      voteMatrixPoll("room:!room:example", "$poll", {
        client,
        optionIndex: 1,
      }),
    ).rejects.toThrow("is not a Matrix poll start event");
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("accepts decrypted poll start events returned from encrypted rooms", async () => {
    const { client, getEvent, sendEvent } = makeClient();
    getEvent.mockResolvedValue({
      type: "m.poll.start",
      content: {
        "m.poll.start": {
          question: { "m.text": "Lunch?" },
          max_selections: 1,
          answers: [{ id: "a1", "m.text": "Pizza" }],
        },
      },
    });

    await expect(
      voteMatrixPoll("room:!room:example", "$poll", {
        client,
        optionIndex: 1,
      }),
    ).resolves.toMatchObject({
      pollId: "$poll",
      answerIds: ["a1"],
    });
    expect(sendEvent).toHaveBeenCalledWith("!room:example", "m.poll.response", {
      "m.poll.response": { answers: ["a1"] },
      "org.matrix.msc3381.poll.response": { answers: ["a1"] },
      "m.relates_to": {
        rel_type: "m.reference",
        event_id: "$poll",
      },
    });
  });
});

describe("sendTypingMatrix", () => {
  beforeAll(async () => {
    setMatrixRuntime(runtimeStub);
    ({ sendTypingMatrix } = await import("./send.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setMatrixRuntime(runtimeStub);
  });

  it("normalizes room-prefixed targets before sending typing state", async () => {
    const setTyping = vi.fn().mockResolvedValue(undefined);
    const client = {
      setTyping,
    } as unknown as import("./sdk.js").MatrixClient;

    await sendTypingMatrix("room:!room:example", true, undefined, client);

    expect(setTyping).toHaveBeenCalledWith("!room:example", true, 30_000);
  });
});
