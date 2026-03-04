import type { PluginRuntime, RuntimeLogger } from "openclaw/plugin-sdk/matrix-js";
import type { MatrixAuth } from "../client.js";
import type { MatrixClient } from "../sdk.js";
import type { MatrixRawEvent } from "./types.js";
import { EventType } from "./types.js";
import {
  isMatrixVerificationEventType,
  isMatrixVerificationRequestMsgType,
  matrixVerificationConstants,
} from "./verification-utils.js";

const MAX_TRACKED_VERIFICATION_EVENTS = 1024;

type MatrixVerificationStage = "request" | "ready" | "start" | "cancel" | "done" | "other";

type MatrixVerificationSummaryLike = {
  id: string;
  transactionId?: string;
  roomId?: string;
  otherUserId: string;
  phaseName: string;
  updatedAt?: string;
  completed?: boolean;
  sas?: {
    decimal?: [number, number, number];
    emoji?: Array<[string, string]>;
  };
};

function trimMaybeString(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readVerificationSignal(event: MatrixRawEvent): {
  stage: MatrixVerificationStage;
  flowId: string | null;
} | null {
  const type = trimMaybeString(event?.type) ?? "";
  const content = event?.content ?? {};
  const msgtype = trimMaybeString((content as { msgtype?: unknown }).msgtype) ?? "";
  const relatedEventId = trimMaybeString(
    (content as { "m.relates_to"?: { event_id?: unknown } })["m.relates_to"]?.event_id,
  );
  const transactionId = trimMaybeString((content as { transaction_id?: unknown }).transaction_id);
  if (type === EventType.RoomMessage && isMatrixVerificationRequestMsgType(msgtype)) {
    return {
      stage: "request",
      flowId: trimMaybeString(event.event_id) ?? transactionId ?? relatedEventId,
    };
  }
  if (!isMatrixVerificationEventType(type)) {
    return null;
  }
  const flowId = transactionId ?? relatedEventId ?? trimMaybeString(event.event_id);
  if (type === `${matrixVerificationConstants.eventPrefix}request`) {
    return { stage: "request", flowId };
  }
  if (type === `${matrixVerificationConstants.eventPrefix}ready`) {
    return { stage: "ready", flowId };
  }
  if (type === "m.key.verification.start") {
    return { stage: "start", flowId };
  }
  if (type === "m.key.verification.cancel") {
    return { stage: "cancel", flowId };
  }
  if (type === "m.key.verification.done") {
    return { stage: "done", flowId };
  }
  return { stage: "other", flowId };
}

function formatVerificationStageNotice(params: {
  stage: MatrixVerificationStage;
  senderId: string;
  event: MatrixRawEvent;
}): string | null {
  const { stage, senderId, event } = params;
  const content = event.content as { code?: unknown; reason?: unknown };
  switch (stage) {
    case "request":
      return `Matrix verification request received from ${senderId}. Open "Verify by emoji" in your Matrix client to continue.`;
    case "ready":
      return `Matrix verification is ready with ${senderId}. Choose "Verify by emoji" to reveal the emoji sequence.`;
    case "start":
      return `Matrix verification started with ${senderId}.`;
    case "done":
      return `Matrix verification completed with ${senderId}.`;
    case "cancel": {
      const code = trimMaybeString(content.code);
      const reason = trimMaybeString(content.reason);
      if (code && reason) {
        return `Matrix verification cancelled by ${senderId} (${code}: ${reason}).`;
      }
      if (reason) {
        return `Matrix verification cancelled by ${senderId} (${reason}).`;
      }
      return `Matrix verification cancelled by ${senderId}.`;
    }
    default:
      return null;
  }
}

function formatVerificationSasNotice(summary: MatrixVerificationSummaryLike): string | null {
  const sas = summary.sas;
  if (!sas) {
    return null;
  }
  const emojiLine =
    Array.isArray(sas.emoji) && sas.emoji.length > 0
      ? `SAS emoji: ${sas.emoji
          .map(
            ([emoji, name]) => `${trimMaybeString(emoji) ?? "?"} ${trimMaybeString(name) ?? "?"}`,
          )
          .join(" | ")}`
      : null;
  const decimalLine =
    Array.isArray(sas.decimal) && sas.decimal.length === 3
      ? `SAS decimal: ${sas.decimal.join(" ")}`
      : null;
  if (!emojiLine && !decimalLine) {
    return null;
  }
  const lines = [`Matrix verification SAS with ${summary.otherUserId}:`];
  if (emojiLine) {
    lines.push(emojiLine);
  }
  if (decimalLine) {
    lines.push(decimalLine);
  }
  lines.push("If both sides match, choose 'They match' in your Matrix app.");
  return lines.join("\n");
}

function resolveVerificationFlowCandidates(params: {
  event: MatrixRawEvent;
  flowId: string | null;
}): string[] {
  const { event, flowId } = params;
  const content = event.content as {
    transaction_id?: unknown;
    "m.relates_to"?: { event_id?: unknown };
  };
  const candidates = new Set<string>();
  const add = (value: unknown) => {
    const normalized = trimMaybeString(value);
    if (normalized) {
      candidates.add(normalized);
    }
  };
  add(flowId);
  add(event.event_id);
  add(content.transaction_id);
  add(content["m.relates_to"]?.event_id);
  return Array.from(candidates);
}

function resolveSummaryRecency(summary: MatrixVerificationSummaryLike): number {
  const ts = Date.parse(summary.updatedAt ?? "");
  return Number.isFinite(ts) ? ts : 0;
}

async function resolveVerificationSummaryForSignal(
  client: MatrixClient,
  params: {
    event: MatrixRawEvent;
    senderId: string;
    flowId: string | null;
  },
): Promise<MatrixVerificationSummaryLike | null> {
  if (!client.crypto) {
    return null;
  }
  const list = await client.crypto.listVerifications();
  if (list.length === 0) {
    return null;
  }
  const candidates = resolveVerificationFlowCandidates({
    event: params.event,
    flowId: params.flowId,
  });
  const byTransactionId = list.find((entry) =>
    candidates.some((candidate) => entry.transactionId === candidate),
  );
  if (byTransactionId) {
    return byTransactionId;
  }

  // Fallback for flows where transaction IDs do not match room event IDs consistently.
  const byUser = list
    .filter((entry) => entry.otherUserId === params.senderId && entry.completed !== true)
    .sort((a, b) => resolveSummaryRecency(b) - resolveSummaryRecency(a))[0];
  return byUser ?? null;
}

function trackBounded(set: Set<string>, value: string): boolean {
  if (!value || set.has(value)) {
    return false;
  }
  set.add(value);
  if (set.size > MAX_TRACKED_VERIFICATION_EVENTS) {
    const oldest = set.values().next().value;
    if (typeof oldest === "string") {
      set.delete(oldest);
    }
  }
  return true;
}

async function sendVerificationNotice(params: {
  client: MatrixClient;
  roomId: string;
  body: string;
  logVerboseMessage: (message: string) => void;
}): Promise<void> {
  const roomId = trimMaybeString(params.roomId);
  if (!roomId) {
    return;
  }
  try {
    await params.client.sendMessage(roomId, {
      msgtype: "m.notice",
      body: params.body,
    });
  } catch (err) {
    params.logVerboseMessage(
      `matrix: failed sending verification notice room=${roomId}: ${String(err)}`,
    );
  }
}

export function registerMatrixMonitorEvents(params: {
  client: MatrixClient;
  auth: MatrixAuth;
  logVerboseMessage: (message: string) => void;
  warnedEncryptedRooms: Set<string>;
  warnedCryptoMissingRooms: Set<string>;
  logger: RuntimeLogger;
  formatNativeDependencyHint: PluginRuntime["system"]["formatNativeDependencyHint"];
  onRoomMessage: (roomId: string, event: MatrixRawEvent) => void | Promise<void>;
}): void {
  const {
    client,
    auth,
    logVerboseMessage,
    warnedEncryptedRooms,
    warnedCryptoMissingRooms,
    logger,
    formatNativeDependencyHint,
    onRoomMessage,
  } = params;
  const routedVerificationEvents = new Set<string>();
  const routedVerificationSasFingerprints = new Set<string>();

  const routeVerificationEvent = (roomId: string, event: MatrixRawEvent): boolean => {
    const senderId = trimMaybeString(event?.sender);
    if (!senderId) {
      return false;
    }
    const signal = readVerificationSignal(event);
    if (!signal) {
      return false;
    }

    void (async () => {
      const flowId = signal.flowId;
      const sourceEventId = trimMaybeString(event?.event_id);
      const sourceFingerprint = sourceEventId ?? `${senderId}:${event.type}:${flowId ?? "none"}`;
      if (!trackBounded(routedVerificationEvents, sourceFingerprint)) {
        return;
      }

      const stageNotice = formatVerificationStageNotice({ stage: signal.stage, senderId, event });
      const summary = await resolveVerificationSummaryForSignal(client, {
        event,
        senderId,
        flowId,
      }).catch(() => null);
      const sasNotice = summary ? formatVerificationSasNotice(summary) : null;

      const notices: string[] = [];
      if (stageNotice) {
        notices.push(stageNotice);
      }
      if (summary && sasNotice) {
        const sasFingerprint = `${summary.id}:${JSON.stringify(summary.sas)}`;
        if (trackBounded(routedVerificationSasFingerprints, sasFingerprint)) {
          notices.push(sasNotice);
        }
      }
      if (notices.length === 0) {
        return;
      }

      for (const body of notices) {
        await sendVerificationNotice({
          client,
          roomId,
          body,
          logVerboseMessage,
        });
      }
    })().catch((err) => {
      logVerboseMessage(`matrix: failed routing verification event: ${String(err)}`);
    });

    return true;
  };

  client.on("room.message", (roomId: string, event: MatrixRawEvent) => {
    if (routeVerificationEvent(roomId, event)) {
      return;
    }
    void onRoomMessage(roomId, event);
  });

  client.on("room.encrypted_event", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    const eventType = event?.type ?? "unknown";
    logVerboseMessage(`matrix: encrypted event room=${roomId} type=${eventType} id=${eventId}`);
  });

  client.on("room.decrypted_event", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    const eventType = event?.type ?? "unknown";
    logVerboseMessage(`matrix: decrypted event room=${roomId} type=${eventType} id=${eventId}`);
  });

  client.on(
    "room.failed_decryption",
    async (roomId: string, event: MatrixRawEvent, error: Error) => {
      logger.warn("Failed to decrypt message", {
        roomId,
        eventId: event.event_id,
        error: error.message,
      });
      logVerboseMessage(
        `matrix: failed decrypt room=${roomId} id=${event.event_id ?? "unknown"} error=${error.message}`,
      );
    },
  );

  client.on("room.invite", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    const sender = event?.sender ?? "unknown";
    const isDirect = (event?.content as { is_direct?: boolean } | undefined)?.is_direct === true;
    logVerboseMessage(
      `matrix: invite room=${roomId} sender=${sender} direct=${String(isDirect)} id=${eventId}`,
    );
  });

  client.on("room.join", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    logVerboseMessage(`matrix: join room=${roomId} id=${eventId}`);
  });

  client.on("room.event", (roomId: string, event: MatrixRawEvent) => {
    const eventType = event?.type ?? "unknown";
    if (eventType === EventType.RoomMessageEncrypted) {
      logVerboseMessage(
        `matrix: encrypted raw event room=${roomId} id=${event?.event_id ?? "unknown"}`,
      );
      if (auth.encryption !== true && !warnedEncryptedRooms.has(roomId)) {
        warnedEncryptedRooms.add(roomId);
        const warning =
          "matrix: encrypted event received without encryption enabled; set channels.matrix-js.encryption=true and verify the device to decrypt";
        logger.warn(warning, { roomId });
      }
      if (auth.encryption === true && !client.crypto && !warnedCryptoMissingRooms.has(roomId)) {
        warnedCryptoMissingRooms.add(roomId);
        const hint = formatNativeDependencyHint({
          packageName: "@matrix-org/matrix-sdk-crypto-nodejs",
          manager: "pnpm",
          downloadCommand: "node node_modules/@matrix-org/matrix-sdk-crypto-nodejs/download-lib.js",
        });
        const warning = `matrix: encryption enabled but crypto is unavailable; ${hint}`;
        logger.warn(warning, { roomId });
      }
      return;
    }
    if (eventType === EventType.RoomMember) {
      const membership = (event?.content as { membership?: string } | undefined)?.membership;
      const stateKey = (event as { state_key?: string }).state_key ?? "";
      logVerboseMessage(
        `matrix: member event room=${roomId} stateKey=${stateKey} membership=${membership ?? "unknown"}`,
      );
    }

    routeVerificationEvent(roomId, event);
  });
}
