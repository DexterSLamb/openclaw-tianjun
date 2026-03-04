import type {
  GatewayRequestHandlerOptions,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/matrix-js";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/matrix-js";
import { matrixPlugin } from "./src/channel.js";
import { registerMatrixJsCli } from "./src/cli.js";
import {
  bootstrapMatrixVerification,
  getMatrixVerificationStatus,
  verifyMatrixRecoveryKey,
} from "./src/matrix/actions/verification.js";
import { setMatrixRuntime } from "./src/runtime.js";

const plugin = {
  id: "matrix-js",
  name: "Matrix-js",
  description: "Matrix channel plugin (matrix-js-sdk)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setMatrixRuntime(api.runtime);
    api.registerChannel({ plugin: matrixPlugin });

    const sendError = (respond: (ok: boolean, payload?: unknown) => void, err: unknown) => {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    };

    api.registerGatewayMethod(
      "matrix-js.verify.recoveryKey",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const key = typeof params?.key === "string" ? params.key : "";
          if (!key.trim()) {
            respond(false, { error: "key required" });
            return;
          }
          const accountId =
            typeof params?.accountId === "string"
              ? params.accountId.trim() || undefined
              : undefined;
          const result = await verifyMatrixRecoveryKey(key, { accountId });
          respond(result.success, result);
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "matrix-js.verify.bootstrap",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const accountId =
            typeof params?.accountId === "string"
              ? params.accountId.trim() || undefined
              : undefined;
          const recoveryKey =
            typeof params?.recoveryKey === "string" ? params.recoveryKey : undefined;
          const forceResetCrossSigning = params?.forceResetCrossSigning === true;
          const result = await bootstrapMatrixVerification({
            accountId,
            recoveryKey,
            forceResetCrossSigning,
          });
          respond(result.success, result);
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "matrix-js.verify.status",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const accountId =
            typeof params?.accountId === "string"
              ? params.accountId.trim() || undefined
              : undefined;
          const includeRecoveryKey = params?.includeRecoveryKey === true;
          const status = await getMatrixVerificationStatus({ accountId, includeRecoveryKey });
          respond(true, status);
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerCli(
      ({ program }) => {
        registerMatrixJsCli({ program });
      },
      { commands: ["matrix-js"] },
    );
  },
};

export default plugin;
