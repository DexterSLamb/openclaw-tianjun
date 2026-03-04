import { createMatrixClient, resolveMatrixAuth } from "../src/matrix/client.js";
import { installLiveHarnessRuntime, resolveLiveHarnessConfig } from "./live-common.js";

type MatrixCryptoProbe = {
  isCrossSigningReady?: () => Promise<boolean>;
  userHasCrossSigningKeys?: (userId?: string, downloadUncached?: boolean) => Promise<boolean>;
  bootstrapCrossSigning?: (opts: {
    setupNewCrossSigning?: boolean;
    authUploadDeviceSigningKeys?: <T>(
      makeRequest: (authData: Record<string, unknown> | null) => Promise<T>,
    ) => Promise<T>;
  }) => Promise<void>;
};

async function main() {
  const base = resolveLiveHarnessConfig();
  const cfg = installLiveHarnessRuntime(base);
  (cfg.channels["matrix-js"] as { encryption: boolean }).encryption = true;

  const auth = await resolveMatrixAuth({ cfg: cfg as never });
  const client = await createMatrixClient({
    homeserver: auth.homeserver,
    userId: auth.userId,
    accessToken: auth.accessToken,
    password: auth.password,
    deviceId: auth.deviceId,
    encryption: true,
  });
  const initCrypto = (client as unknown as { initializeCryptoIfNeeded?: () => Promise<void> })
    .initializeCryptoIfNeeded;
  if (typeof initCrypto === "function") {
    await initCrypto.call(client);
  }

  const inner = (client as unknown as { client?: { getCrypto?: () => unknown } }).client;
  const crypto = (inner?.getCrypto?.() ?? null) as MatrixCryptoProbe | null;
  const userId = auth.userId;
  const password = auth.password;

  const out: Record<string, unknown> = {
    userId,
    hasCrypto: Boolean(crypto),
    readyBefore: null,
    hasKeysBefore: null,
    bootstrap: "skipped",
    readyAfter: null,
    hasKeysAfter: null,
    queryHasMaster: null,
    queryHasSelfSigning: null,
    queryHasUserSigning: null,
  };

  if (!crypto || !crypto.bootstrapCrossSigning) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  if (typeof crypto.isCrossSigningReady === "function") {
    out.readyBefore = await crypto.isCrossSigningReady().catch((err) => `error:${String(err)}`);
  }
  if (typeof crypto.userHasCrossSigningKeys === "function") {
    out.hasKeysBefore = await crypto
      .userHasCrossSigningKeys(userId, true)
      .catch((err) => `error:${String(err)}`);
  }

  const authUploadDeviceSigningKeys = async <T>(
    makeRequest: (authData: Record<string, unknown> | null) => Promise<T>,
  ): Promise<T> => {
    try {
      return await makeRequest(null);
    } catch {
      try {
        return await makeRequest({ type: "m.login.dummy" });
      } catch {
        if (!password?.trim()) {
          throw new Error("Missing password for m.login.password fallback");
        }
        return await makeRequest({
          type: "m.login.password",
          identifier: { type: "m.id.user", user: userId },
          password,
        });
      }
    }
  };

  try {
    await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys });
    out.bootstrap = "ok";
  } catch (err) {
    out.bootstrap = "error";
    out.bootstrapError = err instanceof Error ? err.message : String(err);
  }

  if (typeof crypto.isCrossSigningReady === "function") {
    out.readyAfter = await crypto.isCrossSigningReady().catch((err) => `error:${String(err)}`);
  }
  if (typeof crypto.userHasCrossSigningKeys === "function") {
    out.hasKeysAfter = await crypto
      .userHasCrossSigningKeys(userId, true)
      .catch((err) => `error:${String(err)}`);
  }

  const query = (await client.doRequest("POST", "/_matrix/client/v3/keys/query", undefined, {
    device_keys: { [userId]: [] },
  })) as {
    master_keys?: Record<string, unknown>;
    self_signing_keys?: Record<string, unknown>;
    user_signing_keys?: Record<string, unknown>;
  };

  out.queryHasMaster = Boolean(query.master_keys?.[userId]);
  out.queryHasSelfSigning = Boolean(query.self_signing_keys?.[userId]);
  out.queryHasUserSigning = Boolean(query.user_signing_keys?.[userId]);

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  client.stop();
}

main().catch((err) => {
  process.stderr.write(
    `CROSS_SIGNING_PROBE_ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
