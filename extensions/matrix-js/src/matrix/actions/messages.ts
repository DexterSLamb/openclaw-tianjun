import { resolveMatrixRoomId, sendMessageMatrix } from "../send.js";
import { withResolvedActionClient } from "./client.js";
import { resolveMatrixActionLimit } from "./limits.js";
import { summarizeMatrixRawEvent } from "./summary.js";
import {
  EventType,
  MsgType,
  RelationType,
  type MatrixActionClientOpts,
  type MatrixMessageSummary,
  type MatrixRawEvent,
  type RoomMessageEventContent,
} from "./types.js";

export async function sendMatrixMessage(
  to: string,
  content: string,
  opts: MatrixActionClientOpts & {
    mediaUrl?: string;
    replyToId?: string;
    threadId?: string;
  } = {},
) {
  return await sendMessageMatrix(to, content, {
    mediaUrl: opts.mediaUrl,
    replyToId: opts.replyToId,
    threadId: opts.threadId,
    accountId: opts.accountId,
    client: opts.client,
    timeoutMs: opts.timeoutMs,
  });
}

export async function editMatrixMessage(
  roomId: string,
  messageId: string,
  content: string,
  opts: MatrixActionClientOpts = {},
) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Matrix edit requires content");
  }
  return await withResolvedActionClient(opts, async (client) => {
    const resolvedRoom = await resolveMatrixRoomId(client, roomId);
    const newContent = {
      msgtype: MsgType.Text,
      body: trimmed,
    } satisfies RoomMessageEventContent;
    const payload: RoomMessageEventContent = {
      msgtype: MsgType.Text,
      body: `* ${trimmed}`,
      "m.new_content": newContent,
      "m.relates_to": {
        rel_type: RelationType.Replace,
        event_id: messageId,
      },
    };
    const eventId = await client.sendMessage(resolvedRoom, payload);
    return { eventId: eventId ?? null };
  });
}

export async function deleteMatrixMessage(
  roomId: string,
  messageId: string,
  opts: MatrixActionClientOpts & { reason?: string } = {},
) {
  await withResolvedActionClient(opts, async (client) => {
    const resolvedRoom = await resolveMatrixRoomId(client, roomId);
    await client.redactEvent(resolvedRoom, messageId, opts.reason);
  });
}

export async function readMatrixMessages(
  roomId: string,
  opts: MatrixActionClientOpts & {
    limit?: number;
    before?: string;
    after?: string;
  } = {},
): Promise<{
  messages: MatrixMessageSummary[];
  nextBatch?: string | null;
  prevBatch?: string | null;
}> {
  return await withResolvedActionClient(opts, async (client) => {
    const resolvedRoom = await resolveMatrixRoomId(client, roomId);
    const limit = resolveMatrixActionLimit(opts.limit, 20);
    const token = opts.before?.trim() || opts.after?.trim() || undefined;
    const dir = opts.after ? "f" : "b";
    // Room history is queried via the low-level endpoint for compatibility.
    const res = (await client.doRequest(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(resolvedRoom)}/messages`,
      {
        dir,
        limit,
        from: token,
      },
    )) as { chunk: MatrixRawEvent[]; start?: string; end?: string };
    const messages = res.chunk
      .filter((event) => event.type === EventType.RoomMessage)
      .filter((event) => !event.unsigned?.redacted_because)
      .map(summarizeMatrixRawEvent);
    return {
      messages,
      nextBatch: res.end ?? null,
      prevBatch: res.start ?? null,
    };
  });
}
