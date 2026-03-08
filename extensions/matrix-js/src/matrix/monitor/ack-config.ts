import { resolveAckReaction, type OpenClawConfig } from "openclaw/plugin-sdk/matrix-js";

type MatrixAckReactionScope = "group-mentions" | "group-all" | "direct" | "all" | "none" | "off";

export function resolveMatrixAckReactionConfig(params: {
  cfg: OpenClawConfig;
  agentId: string;
  accountId?: string | null;
}): { ackReaction: string; ackReactionScope: MatrixAckReactionScope } {
  const matrixConfig = params.cfg.channels?.["matrix-js"];
  const accountConfig =
    params.accountId && params.accountId !== "default"
      ? matrixConfig?.accounts?.[params.accountId]
      : undefined;
  const ackReaction = resolveAckReaction(params.cfg, params.agentId, {
    channel: "matrix-js",
    accountId: params.accountId ?? undefined,
  }).trim();
  const ackReactionScope =
    accountConfig?.ackReactionScope ??
    matrixConfig?.ackReactionScope ??
    params.cfg.messages?.ackReactionScope ??
    "group-mentions";
  return { ackReaction, ackReactionScope };
}
