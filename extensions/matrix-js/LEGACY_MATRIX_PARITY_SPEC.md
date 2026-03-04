# Legacy Matrix Plugin Parity Spec

This document defines the expected behavior of the **legacy Matrix plugin** (`extensions/matrix`) so the new **matrix-js plugin** (`extensions/matrix-js`) can be verified for feature parity.

## 1. Scope

- Legacy source of truth:
  - `extensions/matrix/index.ts`
  - `extensions/matrix/src/channel.ts`
  - `extensions/matrix/src/**/*.ts`
- New implementation under test:
  - `extensions/matrix-js/**`
- Goal: matrix-js should preserve user-visible and operator-visible behavior unless explicitly changed.

## 2. Parity Levels

- `MUST`: required parity for GA.
- `SHOULD`: desirable parity; acceptable temporary delta if documented.
- `NICE`: optional parity.

## 3. Channel + Plugin Contract (MUST)

- Plugin id remains `matrix`; channel id exposed to runtime is `matrix` in legacy.
- Channel metadata parity:
  - label/selection/docs path/blurb/order/quickstart allowFrom behavior.
- Channel capabilities parity:
  - `chatTypes`: direct, group, thread
  - `polls`: true
  - `reactions`: true
  - `threads`: true
  - `media`: true
- Reload behavior parity:
  - config prefixes include `channels.matrix`.
- Pairing behavior parity:
  - pairing id label, allow-entry normalization, approval notification message behavior.

## 4. Configuration Contract (MUST)

Legacy schema lives in `extensions/matrix/src/config-schema.ts` and `extensions/matrix/src/types.ts`.

### 4.1 Core fields

- `enabled?: boolean`
- Auth: `homeserver`, `userId`, `accessToken`, `password`, `register`, `deviceId`, `deviceName`
- Sync/runtime: `initialSyncLimit`, `encryption`
- Access control:
  - `allowlistOnly`
  - `groupPolicy`: `open|allowlist|disabled`
  - `groupAllowFrom`
  - `dm.policy`: `pairing|allowlist|open|disabled`
  - `dm.allowFrom`
- Room policy:
  - `groups` (preferred) and `rooms` (legacy alias)
  - room fields: `enabled`, `allow`, `requireMention`, `tools`, `autoReply`, `users`, `skills`, `systemPrompt`
- Reply/thread behavior:
  - `replyToMode`: `off|first|all`
  - `threadReplies`: `off|inbound|always`
- Output shaping:
  - `markdown`, `textChunkLimit`, `chunkMode`, `responsePrefix`
- Media + invites:
  - `mediaMaxMb`
  - `autoJoin`: `always|allowlist|off`
  - `autoJoinAllowlist`
- Action gates:
  - `actions.reactions|messages|pins|memberInfo|channelInfo|verification`

### 4.2 Defaults and effective behavior

- DM default policy: `pairing`.
- Group mention default: mention required in rooms unless room override allows auto-reply.
- `replyToMode` default: `off`.
- `threadReplies` default: `inbound`.
- `autoJoin` default: `always`.
- Legacy global hard text max remains 4000 chars per chunk for matrix sends/replies.
- When `allowlistOnly=true`, policies are effectively tightened:
  - group `open` behaves as `allowlist`
  - DM policy behaves as `allowlist` unless explicitly disabled.

## 5. Account Model + Resolution (MUST)

- Account listing/resolution behavior in `extensions/matrix/src/matrix/accounts.ts`:
  - supports top-level single account fallback (`default` account semantics).
  - supports per-account map and normalized account IDs.
  - per-account config deep-merges known nested sections (`dm`, `actions`) over base config.
- Account configured state logic parity:
  - configured when homeserver exists and one of:
    - access token
    - userId+password
    - matching stored credentials.

## 6. Auth + Client Bootstrap (MUST)

Legacy auth behavior in `extensions/matrix/src/matrix/client/config.ts`:

- Config/env resolution precedence:
  - config values override env values.
  - env vars: `MATRIX_HOMESERVER`, `MATRIX_USER_ID`, `MATRIX_ACCESS_TOKEN`, `MATRIX_PASSWORD`, `MATRIX_REGISTER`, `MATRIX_DEVICE_ID`, `MATRIX_DEVICE_NAME`.
- Token-first behavior:
  - with access token, `whoami` resolves missing `userId` and/or `deviceId`.
- Credential cache behavior:
  - reuses cached credentials when config matches homeserver+user (or homeserver-only token flow).
  - updates `lastUsedAt` when reused.
- Password login behavior:
  - login with `m.login.password` when no token.
- Register mode behavior:
  - if login fails and `register=true`, attempts registration and then login-equivalent token flow.
  - registration mode prepares backup snapshot and finalizes config by turning off `register` and removing stale inline token.
- Bun runtime must be rejected (Node required).

## 7. Runtime/Connection Lifecycle (MUST)

- Gateway startup path (`channel.ts` + `monitor/index.ts`) must:
  - resolve auth,
  - resolve shared client,
  - attach monitor handlers,
  - start sync,
  - report runtime status fields.
- Shutdown behavior:
  - client is stopped on abort,
  - active client reference cleared.
- Startup lock behavior:
  - startup import race is serialized via lock in `channel.ts`.

## 8. Inbound Event Processing (MUST)

Legacy handler logic: `extensions/matrix/src/matrix/monitor/handler.ts`.

### 8.1 Event eligibility

- Processes:
  - `m.room.message`
  - poll start events (`m.poll.start` + MSC aliases)
  - location events (`m.location` and location msgtype)
- Ignores:
  - redacted events
  - self-sent events
  - old pre-startup events
  - edit relation events (`m.replace`)
  - encrypted raw payloads (expects decrypted bridge events)

### 8.2 DM/group detection

- DM detection chain (`monitor/direct.ts`):
  - `m.direct` cache,
  - member-count heuristic (2 users),
  - `is_direct` member-state fallback.

### 8.3 Access control + allowlists

- DM policy behavior:
  - `disabled`: no DM processing.
  - `open`: process all DMs.
  - `allowlist`: process only matching allowlist.
  - `pairing`: create pairing request/code for unauthorized sender and send approval instructions.
- Group policy behavior:
  - `disabled`: ignore rooms.
  - `allowlist`: room must exist in allowlisted rooms map (or wildcard) and pass optional sender constraints.
  - `open`: allow rooms, still mention-gated by default.
- Group sender gating:
  - room-level `users` allowlist if configured.
  - `groupAllowFrom` fallback when room users list not set.

### 8.4 Mention + command gate behavior

- Mention detection parity:
  - `m.mentions.user_ids`
  - `m.mentions.room`
  - `formatted_body` matrix.to links (plain and URL-encoded)
  - mention regex patterns from core mention config
- Default room behavior requires mention unless room policy overrides.
- Control command bypass behavior:
  - unauthorized control commands are dropped in group contexts.

### 8.5 Input normalization

- Poll start events converted to normalized text payload.
- Location events converted to normalized location text + context fields.
- mxc media downloaded (and decrypted when file payload present) with max-byte enforcement.

### 8.6 Context/session/routing

- Builds context with matrix-specific fields:
  - From/To/SessionKey/MessageSid/ReplyToId/MessageThreadId/MediaPath/etc.
- Resolves per-agent route via core routing.
- Persists inbound session metadata and updates last-route for DM contexts.

### 8.7 Reply delivery

- Typing indicators start/stop around reply dispatch.
- Reply prefix/model-selection behavior uses core reply options.
- Room-level `skills` filter and `systemPrompt` are applied.
- Reply delivery semantics:
  - `replyToMode` controls how often replyTo is used (`off|first|all`).
  - thread target suppresses plain replyTo fallback.
  - chunking and markdown-table conversion parity required.

### 8.8 Side effects

- Optional ack reaction based on `messages.ackReaction` + scope rules.
- Read receipt sent for inbound event IDs.
- System event enqueued after successful reply.

## 9. Outbound Sending Contract (MUST)

Legacy send behavior: `extensions/matrix/src/matrix/send.ts` and `send/*`.

### 9.1 Text

- Requires text or media; empty text without media is error.
- Resolves target IDs from `matrix:/room:/channel:/user:/@user/#alias` forms.
- Markdown tables converted via core table mode.
- Markdown converted to Matrix HTML formatting.
- Chunking respects configured limit but hard-caps at 4000.
- Thread relation behavior:
  - `threadId` -> `m.thread` relation.
  - otherwise optional reply relation.

### 9.2 Media

- Loads media via core media loader with size limits.
- Upload behavior:
  - encrypts media in encrypted rooms when crypto available.
  - otherwise plain upload.
- Includes metadata:
  - mimetype/size/duration,
  - image dimensions/thumbnail when available.
- Voice behavior:
  - if `audioAsVoice=true` and compatible audio, send as voice payload (`org.matrix.msc3245.voice`).
- Caption/follow-up behavior:
  - first chunk is caption,
  - remaining text chunks become follow-up messages.

### 9.3 Polls

- Supports `sendPoll` with MSC3381 payload (`m.poll.start`) + fallback text.
- Supports thread relation for polls when thread ID present.

### 9.4 Reactions + receipts + typing

- Supports sending reactions (`m.reaction` annotation).
- Supports typing state and read receipts.

## 10. Tool/Action Contract (MUST)

Legacy action adapter: `src/actions.ts`, `src/tool-actions.ts`, `src/matrix/actions/*`.

### 10.1 Action availability gates

- Baseline actions include `send` and poll path support.
- Optional gated actions:
  - reactions: `react`, `reactions`
  - messages: `read`, `edit`, `delete`
  - pins: `pin`, `unpin`, `list-pins`
  - member info: `member-info`
  - channel info: `channel-info`
  - verification: `permissions` (only with encryption enabled + gate enabled)

### 10.2 Action semantics

- Send/edit/delete/read messages behavior parity:
  - edit uses `m.replace` + `m.new_content` conventions.
  - read uses `/rooms/{room}/messages` with before/after pagination tokens.
- Reaction semantics parity:
  - list aggregates count per emoji and unique users.
  - remove only current-user reactions (optional emoji filter).
- Pin semantics parity:
  - state event `m.room.pinned_events` update/read.
  - list includes resolvable summarized events.
- Member info semantics parity:
  - profile display name/avatar available,
  - membership/power currently returned as `null` placeholders.
- Room info semantics parity:
  - includes name/topic/canonicalAlias/memberCount where retrievable.
- Verification semantics parity:
  - status/list/request/accept/cancel/start/generate-qr/scan-qr/sas/confirm/mismatch/confirm-qr flows.

## 11. Directory + Target Resolution (MUST)

### 11.1 Live directory

- Peer lookup uses Matrix user directory search endpoint.
- Group lookup behavior:
  - alias input (`#...`) resolves via directory API,
  - room ID input (`!...`) is accepted directly,
  - otherwise scans joined rooms by room name.

### 11.2 Resolver behavior

- User resolver rules:
  - full user IDs resolve directly,
  - otherwise requires exact unique match from live directory.
- Group resolver rules:
  - prefers exact match; otherwise first candidate with note.
- Room config key normalization behavior:
  - supports `matrix:`/`room:`/`channel:` prefixes and canonical IDs.

## 12. Status + Probing (MUST)

- Probe behavior (`matrix/probe.ts`):
  - validates homeserver + token,
  - initializes client,
  - resolves user via client and returns elapsed time/status.
- Channel status snapshot includes:
  - configured/baseUrl/running/last start-stop/error/probe/last probe/inbound/outbound fields.

## 13. Storage + Security + E2EE (MUST)

### 13.1 Credential/state paths

- Credentials persisted in state dir under `credentials/matrix`.
- Per-account credential filename semantics preserved.
- Matrix storage paths include account key + homeserver key + user key + token hash.
- Legacy storage migration behavior preserved.

### 13.2 HTTP hardening

- Matrix HTTP client behavior parity:
  - blocks unexpected absolute endpoints,
  - blocks cross-protocol redirects,
  - strips auth headers on cross-origin redirect,
  - supports request timeout.

### 13.3 Encryption

- Rust crypto initialization and bootstrap behavior preserved.
- Decryption bridge behavior preserved:
  - encrypted event handling,
  - failed decrypt retries,
  - retry caps and signal-driven retry.
- Recovery key behavior preserved:
  - persisted securely (0600),
  - reused for secret storage callbacks,
  - handles default key rebind and recreation when needed.

## 14. Onboarding UX Contract (SHOULD)

Legacy onboarding (`src/onboarding.ts`) should remain equivalent:

- checks matrix SDK availability and offers install flow,
- supports env-detected quick setup,
- supports token/password/register auth choice,
- validates homeserver URL and user ID format,
- supports DM policy and allowFrom prompt with user resolution,
- supports optional group policy and group room selection.

## 15. Known Legacy Quirks To Track (NEEDS UPDATING)

These should be explicitly reviewed during parity auditing (either preserve intentionally or fix intentionally):

- `supportsAction`/`poll` behavior in action adapter is non-obvious and should be validated end-to-end.
- Some account-aware callsites pass `accountId` through paths where underlying helpers may not consistently consume it.
- Legacy room/member info actions include placeholder/null fields (`altAliases`, `membership`, `powerLevel`).

## 16. Parity Test Matrix

Use this checklist while validating `extensions/matrix-js`:

- [ ] Config schema keys and defaults are equivalent.
- [ ] Auth precedence (config/env/token/cache/password/register) matches legacy.
- [ ] Bun runtime rejection behavior matches legacy.
- [ ] Startup/shutdown lifecycle and status updates match legacy.
- [ ] DM detection heuristics match legacy.
- [ ] DM/group allowlist + pairing flow matches legacy.
- [ ] Mention detection (`m.mentions`, formatted_body links, regex) matches legacy.
- [ ] Control-command authorization gate behavior matches legacy.
- [ ] Inbound poll normalization matches legacy.
- [ ] Inbound location normalization matches legacy.
- [ ] Inbound media download/decrypt/size-limit behavior matches legacy.
- [ ] Reply dispatch + typing + ack reaction + read receipts match legacy.
- [ ] Thread handling (`threadReplies`) matches legacy.
- [ ] `replyToMode` handling for single/multi reply flows matches legacy.
- [ ] Outbound text chunking, markdown, and formatting behavior matches legacy.
- [ ] Outbound media encryption/voice/thumbnail/duration behavior matches legacy.
- [ ] Outbound poll payload behavior matches legacy.
- [ ] Action gating and action semantics match legacy.
- [ ] Verification action flow and summary semantics match legacy.
- [ ] Directory live lookup + target resolution ambiguity handling matches legacy.
- [ ] Probe/status reporting fields match legacy.
- [ ] Storage layout and credential persistence semantics match legacy.
- [ ] HTTP hardening and decrypt retry behavior matches legacy.

## 17. Minimum Regression Commands

Run at least:

```bash
pnpm vitest extensions/matrix/src/**/*.test.ts
pnpm vitest extensions/matrix-js/src/**/*.test.ts
pnpm build
```

If behavior differs intentionally, document the delta under this spec with:

- reason,
- user impact,
- migration note,
- tests proving new intended behavior.
