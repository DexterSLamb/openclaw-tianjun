import { getMatrixRuntime } from "../../runtime.js";
import type { CoreConfig } from "../../types.js";
import { resolveMatrixAccountConfig } from "../accounts.js";
import {
  ensureMatrixNodeRuntime,
  resolveRuntimeMatrixClient,
  type ResolvedRuntimeMatrixClient,
} from "../client-bootstrap.js";
import type { MatrixClient } from "../sdk.js";

const getCore = () => getMatrixRuntime();

export function ensureNodeRuntime() {
  ensureMatrixNodeRuntime();
}

export function resolveMediaMaxBytes(accountId?: string | null): number | undefined {
  const cfg = getCore().config.loadConfig() as CoreConfig;
  const matrixCfg = resolveMatrixAccountConfig({ cfg, accountId });
  const mediaMaxMb = typeof matrixCfg.mediaMaxMb === "number" ? matrixCfg.mediaMaxMb : undefined;
  if (typeof mediaMaxMb === "number") {
    return mediaMaxMb * 1024 * 1024;
  }
  return undefined;
}

export async function resolveMatrixClient(opts: {
  client?: MatrixClient;
  timeoutMs?: number;
  accountId?: string | null;
}): Promise<{ client: MatrixClient; stopOnDone: boolean }> {
  return await resolveRuntimeMatrixClient({
    client: opts.client,
    timeoutMs: opts.timeoutMs,
    accountId: opts.accountId,
    onResolved: async (client, context) => {
      if (context.createdForOneOff) {
        await client.prepareForOneOff();
      }
    },
  });
}

export function stopResolvedMatrixClient(resolved: ResolvedRuntimeMatrixClient): void {
  if (resolved.stopOnDone) {
    resolved.client.stop();
  }
}

export async function withResolvedMatrixClient<T>(
  opts: {
    client?: MatrixClient;
    timeoutMs?: number;
    accountId?: string | null;
  },
  run: (client: MatrixClient) => Promise<T>,
): Promise<T> {
  const resolved = await resolveMatrixClient(opts);
  try {
    return await run(resolved.client);
  } finally {
    stopResolvedMatrixClient(resolved);
  }
}
