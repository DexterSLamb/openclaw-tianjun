# Legacy Matrix Parity Gap Audit

Audit date: February 23, 2026

Scope:

- Baseline spec: `<repo-root>/extensions/matrix-js/LEGACY_MATRIX_PARITY_SPEC.md`
- Compared implementations:
  - Legacy: `<repo-root>/extensions/matrix`
  - New: `<repo-root>/extensions/matrix-js`

Method:

- Static code comparison and targeted file inspection.
- Runtime validation executed for matrix-js test suites and project build.

Status legend:

- `PASS (static)` = code-level parity confirmed.
- `NEEDS UPDATING` = concrete parity/coexistence gap found.
- `UNVERIFIED (runtime)` = requires executing tests/integration flows.

## Summary

- Overall feature parity with legacy behavior: strong at code level.
- Previously identified dual-plugin coexistence blockers are resolved in code.
- Matrix-js regression tests pass (`27` files, `112` tests).
- Full repository build passes after the matrix-js namespace/storage changes.
- Remaining runtime validation gap: explicit side-by-side legacy `matrix` + `matrix-js` integration run.

## Coexistence Gaps (Current Status)

1. `PASS (static)`: Channel identity is consistent as `matrix-js` across metadata and runtime registration.

- Evidence:
  - `<repo-root>/extensions/matrix-js/index.ts:7`
  - `<repo-root>/extensions/matrix-js/openclaw.plugin.json:2`
  - `<repo-root>/extensions/matrix-js/src/channel.ts:41`
  - `<repo-root>/extensions/matrix-js/src/channel.ts:99`

2. `PASS (static)`: Config namespace is consistently `channels.matrix-js`.

- Evidence:
  - `<repo-root>/extensions/matrix-js/src/channel.ts:116`
  - `<repo-root>/extensions/matrix-js/src/channel.ts:125`
  - `<repo-root>/extensions/matrix-js/src/channel.ts:319`
  - `<repo-root>/extensions/matrix-js/src/onboarding.ts:17`
  - `<repo-root>/extensions/matrix-js/src/onboarding.ts:174`
  - `<repo-root>/extensions/matrix-js/src/matrix/send/client.ts:22`
  - `<repo-root>/extensions/matrix-js/src/matrix/client/config.ts:125`

3. `PASS (static)`: Outbound/inbound channel tags and routing context emit `matrix-js`.

- Evidence:
  - `<repo-root>/extensions/matrix-js/src/outbound.ts:20`
  - `<repo-root>/extensions/matrix-js/src/outbound.ts:36`
  - `<repo-root>/extensions/matrix-js/src/outbound.ts:49`
  - `<repo-root>/extensions/matrix-js/src/matrix/send.ts:55`
  - `<repo-root>/extensions/matrix-js/src/matrix/monitor/handler.ts:496`
  - `<repo-root>/extensions/matrix-js/src/matrix/monitor/handler.ts:509`

4. `PASS (static)`: Matrix-js now uses isolated storage namespace/prefixes.

- Evidence:
  - `<repo-root>/extensions/matrix-js/src/matrix/credentials.ts:31`
  - `<repo-root>/extensions/matrix-js/src/matrix/client/storage.ts:42`
  - `<repo-root>/extensions/matrix-js/src/matrix/sdk/idb-persistence.ts:127`
  - `<repo-root>/extensions/matrix-js/src/matrix/client/create-client.ts:43`

## Parity Matrix (Spec Section 16, Pre-Filled)

| Check                                                                        | Status        | Evidence                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config schema keys and defaults are equivalent                               | PASS (static) | `<repo-root>/extensions/matrix/src/config-schema.ts` vs `<repo-root>/extensions/matrix-js/src/config-schema.ts` (no semantic diffs)                                                                                  |
| Auth precedence (config/env/token/cache/password/register) matches legacy    | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/client/config.ts`                                                                                                                                                       |
| Bun runtime rejection behavior matches legacy                                | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/client/runtime.ts`, `<repo-root>/extensions/matrix-js/src/matrix/monitor/index.ts`                                                                                      |
| Startup/shutdown lifecycle and status updates match legacy                   | PASS (static) | `<repo-root>/extensions/matrix-js/src/channel.ts`, `<repo-root>/extensions/matrix-js/src/matrix/monitor/index.ts`                                                                                                    |
| DM detection heuristics match legacy                                         | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/direct.ts`                                                                                                                                                      |
| DM/group allowlist + pairing flow matches legacy                             | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/handler.ts`, `<repo-root>/extensions/matrix-js/src/matrix/monitor/allowlist.ts`                                                                                 |
| Mention detection (`m.mentions`, formatted_body links, regex) matches legacy | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/mentions.ts`                                                                                                                                                    |
| Control-command authorization gate behavior matches legacy                   | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/handler.ts`                                                                                                                                                     |
| Inbound poll normalization matches legacy                                    | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/poll-types.ts`, `<repo-root>/extensions/matrix-js/src/matrix/monitor/handler.ts`                                                                                        |
| Inbound location normalization matches legacy                                | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/location.ts`                                                                                                                                                    |
| Inbound media download/decrypt/size-limit behavior matches legacy            | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/media.ts`                                                                                                                                                       |
| Reply dispatch + typing + ack reaction + read receipts match legacy          | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/handler.ts`, `<repo-root>/extensions/matrix-js/src/matrix/monitor/replies.ts`                                                                                   |
| Thread handling (`threadReplies`) matches legacy                             | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/threads.ts`                                                                                                                                                     |
| `replyToMode` handling for single/multi reply flows matches legacy           | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/monitor/replies.ts`                                                                                                                                                     |
| Outbound text chunking, markdown, and formatting behavior matches legacy     | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/send.ts`, `<repo-root>/extensions/matrix-js/src/matrix/send/formatting.ts`                                                                                              |
| Outbound media encryption/voice/thumbnail/duration behavior matches legacy   | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/send/media.ts`                                                                                                                                                          |
| Outbound poll payload behavior matches legacy                                | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/send.ts`, `<repo-root>/extensions/matrix-js/src/matrix/poll-types.ts`                                                                                                   |
| Action gating and action semantics match legacy                              | PASS (static) | `<repo-root>/extensions/matrix-js/src/actions.ts`, `<repo-root>/extensions/matrix-js/src/tool-actions.ts`, `<repo-root>/extensions/matrix-js/src/matrix/actions/*`                                                   |
| Verification action flow and summary semantics match legacy                  | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/actions/verification.ts`, `<repo-root>/extensions/matrix-js/src/matrix/sdk/verification-manager.ts`, `<repo-root>/extensions/matrix-js/src/matrix/sdk/crypto-facade.ts` |
| Directory live lookup + target resolution ambiguity handling matches legacy  | PASS (static) | `<repo-root>/extensions/matrix-js/src/directory-live.ts`, `<repo-root>/extensions/matrix-js/src/resolve-targets.ts`                                                                                                  |
| Probe/status reporting fields match legacy                                   | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/probe.ts`, `<repo-root>/extensions/matrix-js/src/channel.ts`                                                                                                            |
| Storage layout and credential persistence semantics match legacy             | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/client/storage.ts`, `<repo-root>/extensions/matrix-js/src/matrix/credentials.ts`                                                                                        |
| HTTP hardening and decrypt retry behavior matches legacy                     | PASS (static) | `<repo-root>/extensions/matrix-js/src/matrix/sdk/http-client.ts`, `<repo-root>/extensions/matrix-js/src/matrix/sdk/decrypt-bridge.ts`, `<repo-root>/extensions/matrix-js/src/matrix/sdk.ts`                          |

## Runtime Validation Status

- `PASS (runtime)`: matrix-js regression run succeeded via `pnpm test extensions/matrix-js/src` (`27` files, `112` tests).
- `PASS (runtime)`: build/type pipeline succeeded via `pnpm build`.
- `UNVERIFIED (runtime)`: side-by-side load of legacy `matrix` plus `matrix-js` with independent config.

Recommended commands for final coexistence sign-off:

```bash
pnpm test extensions/matrix/src
pnpm test extensions/matrix-js/src
pnpm build
```

## Suggested Next Fix Batch

1. Add explicit coexistence integration tests:

- Load both legacy `matrix` and `matrix-js` in one runtime with independent config + pairing state.

2. Validate state migration behavior (if required by product decision):

- Decide whether `matrix-js` should intentionally read legacy `channels.matrix`/`credentials/matrix` during transition or stay fully isolated.
