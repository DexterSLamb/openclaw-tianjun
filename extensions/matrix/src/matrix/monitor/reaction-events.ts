import type { PluginRuntime } from "openclaw/plugin-sdk/matrix";
import type { CoreConfig } from "../../types.js";
import { resolveMatrixAccountConfig } from "../accounts.js";
import { extractMatrixReactionAnnotation } from "../reaction-common.js";
import type { MatrixClient } from "../sdk.js";
import type { MatrixRawEvent } from "./types.js";

export type MatrixReactionNotificationMode = "off" | "own";

export function resolveMatrixReactionNotificationMode(params: {
  cfg: CoreConfig;
  accountId: string;
}): MatrixReactionNotificationMode {
  const matrixConfig = params.cfg.channels?.matrix;
  const accountConfig = resolveMatrixAccountConfig({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return accountConfig.reactionNotifications ?? matrixConfig?.reactionNotifications ?? "own";
}

export async function handleInboundMatrixReaction(params: {
  client: MatrixClient;
  core: PluginRuntime;
  cfg: CoreConfig;
  accountId: string;
  roomId: string;
  event: MatrixRawEvent;
  senderId: string;
  senderLabel: string;
  selfUserId: string;
  isDirectMessage: boolean;
  logVerboseMessage: (message: string) => void;
}): Promise<void> {
  const notificationMode = resolveMatrixReactionNotificationMode({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  if (notificationMode === "off") {
    return;
  }

  const reaction = extractMatrixReactionAnnotation(params.event.content);
  if (!reaction?.eventId) {
    return;
  }

  const targetEvent = await params.client.getEvent(params.roomId, reaction.eventId).catch((err) => {
    params.logVerboseMessage(
      `matrix: failed resolving reaction target room=${params.roomId} id=${reaction.eventId}: ${String(err)}`,
    );
    return null;
  });
  const targetSender =
    targetEvent && typeof targetEvent.sender === "string" ? targetEvent.sender.trim() : "";
  if (!targetSender) {
    return;
  }
  if (notificationMode === "own" && targetSender !== params.selfUserId) {
    return;
  }

  const route = params.core.channel.routing.resolveAgentRoute({
    cfg: params.cfg,
    channel: "matrix",
    accountId: params.accountId,
    peer: {
      kind: params.isDirectMessage ? "direct" : "channel",
      id: params.isDirectMessage ? params.senderId : params.roomId,
    },
  });
  const text = `Matrix reaction added: ${reaction.key} by ${params.senderLabel} on msg ${reaction.eventId}`;
  params.core.system.enqueueSystemEvent(text, {
    sessionKey: route.sessionKey,
    contextKey: `matrix:reaction:add:${params.roomId}:${reaction.eventId}:${params.senderId}:${reaction.key}`,
  });
  params.logVerboseMessage(
    `matrix: reaction event enqueued room=${params.roomId} target=${reaction.eventId} sender=${params.senderId} emoji=${reaction.key}`,
  );
}
