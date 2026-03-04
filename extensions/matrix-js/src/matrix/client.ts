export type { MatrixAuth, MatrixResolvedConfig } from "./client/types.js";
export { isBunRuntime } from "./client/runtime.js";
export {
  getMatrixScopedEnvVarNames,
  hasReadyMatrixEnvAuth,
  resolveMatrixConfig,
  resolveMatrixConfigForAccount,
  resolveScopedMatrixEnvConfig,
  resolveMatrixAuth,
} from "./client/config.js";
export { createMatrixClient } from "./client/create-client.js";
export {
  resolveSharedMatrixClient,
  waitForMatrixSync,
  stopSharedClient,
  stopSharedClientForAccount,
} from "./client/shared.js";
