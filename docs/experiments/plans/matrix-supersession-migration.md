---
summary: "Replace the legacy Matrix plugin with the new Matrix implementation while preserving the public matrix surface and providing automatic migration for current users."
owner: "gumadeiras"
status: "in progress"
last_updated: "2026-03-08"
title: "Matrix Supersession Migration"
---

# Matrix Supersession Migration

## Overview

This plan replaces the current public `matrix` plugin with the newer Matrix implementation that currently lives under `matrix-js`.

The external result should feel like an in-place upgrade for existing Matrix users:

- package stays `@openclaw/matrix`
- plugin/channel/binding id stays `matrix`
- config stays under `channels.matrix`
- existing public Matrix state stays canonical
- automatic migration handles everything deterministic
- non-deterministic cases surface clear, exact next steps

This plan is also the working implementation tracker. Update the checklist statuses as tasks land.

## Progress tracker

### Current status

- [x] Migration plan written and tracked in repo
- [ ] Replace `extensions/matrix` with the new implementation
- [ ] Remove shipped `matrix-js` public/runtime/package surfaces
- [ ] Preserve legacy `matrix` config compatibility
- [ ] Preserve legacy `matrix` state compatibility
- [ ] Add startup and doctor migration/repair UX
- [ ] Rewrite docs/help/tests to use `matrix` only
- [ ] Verify update flow end to end

### Change log

- 2026-03-08: Initial supersession plan written and added to docs as a live checklist.

## Summary

- Replace the current `extensions/matrix` implementation with the current Matrix-js implementation, then delete `extensions/matrix-js`.
- Ship the new implementation only as `matrix`: same npm package (`@openclaw/matrix`), same plugin id (`matrix`), same channel id (`matrix`), same config key (`channels.matrix`), same docs path (`/channels/matrix`), same local install path (`extensions/matrix`).
- Do not ship any `matrix-js` runtime compatibility aliases, config aliases, CLI aliases, gateway-method aliases, or package aliases.
- Preserve existing public `matrix` user configs and state as the source of truth. The migration should feel like an in-place upgrade, not a channel rename.
- Use automatic repair on startup and in doctor/update. If repair cannot be done safely, emit explicit, actionable messaging.

## Public surface after cutover

- [ ] Canonical package/install surface stays `@openclaw/matrix` and `openclaw plugins install @openclaw/matrix`.
- [ ] Canonical channel/plugin/binding id is `matrix`.
- [ ] Canonical config namespace is `channels.matrix`.
- [ ] Canonical CLI surface is `openclaw matrix ...`, including the verification/account commands currently only exposed under Matrix-js.
- [ ] Canonical gateway methods become `matrix.verify.status`, `matrix.verify.bootstrap`, and `matrix.verify.recoveryKey`.
- [ ] Canonical ACP/subagent binding channel is `matrix`.
- [ ] Canonical plugin SDK subpath is `openclaw/plugin-sdk/matrix`.
- [ ] Remove all shipped/public `matrix-js` references from docs, config help, tests, install catalog metadata, and package exports.

## Migration flow and UX

### Standard npm users

- [ ] No config key change required.
- [ ] No plugin install record rewrite required because the package remains `@openclaw/matrix`.
- [ ] Updating OpenClaw or running `openclaw plugins update` replaces the plugin in place.
- [ ] Startup and doctor automatically repair any legacy Matrix config/state that the new implementation cannot consume directly.

### Startup behavior

- [ ] Keep the existing startup auto-migration model.
- [ ] On first startup after upgrade, detect legacy Matrix config/state mismatches and repair them automatically when the repair is deterministic and local.
- [ ] Log a concise one-time summary of what was migrated and only show next steps when user action is still required.

### Doctor and update behavior

- [ ] `openclaw doctor --fix` and update-triggered doctor run the same Matrix migration logic, but with richer user-facing output.
- [ ] Doctor shows exactly which Matrix paths/keys were changed and why.
- [ ] Doctor validates the installed Matrix plugin source and surfaces manual repair steps for custom path installs.

### Custom or local-path installs

- [ ] Do not auto-rewrite arbitrary custom plugin paths.
- [ ] If the legacy Matrix plugin was installed from a custom path and that path is now stale or missing, warn clearly and print the exact replacement command or path to use.
- [ ] If the custom path is valid and already points at the replacement plugin, leave it alone.

### Unsupported scope

- [ ] No backward compatibility for internal `matrix-js` adopters.
- [ ] Do not auto-migrate `channels.matrix-js`, `@openclaw/matrix-js`, `openclaw matrix-js`, or `plugins.entries["matrix-js"]`.

## Implementation changes

### 1. Replace identity at the package and plugin layer

- [ ] Overwrite `extensions/matrix` with the Matrix-js implementation instead of renaming user-facing config.
- [ ] Delete `extensions/matrix-js` after the port is complete.
- [ ] Update `extensions/matrix/package.json`, `extensions/matrix/openclaw.plugin.json`, and `extensions/matrix/index.ts` so the package remains `@openclaw/matrix` but exposes the new feature set.
- [ ] Port the Matrix-js CLI and gateway-method registration into `extensions/matrix/index.ts` and register it under `matrix`, not `matrix-js`.
- [ ] Replace all internal `openclaw/plugin-sdk/matrix-js` imports with `openclaw/plugin-sdk/matrix`.
- [ ] Replace the plugin SDK implementation behind `src/plugin-sdk/matrix.ts` with the Matrix-js helper surface superset, then remove the `matrix-js` plugin-sdk export from `package.json`, `scripts/check-plugin-sdk-exports.mjs`, `scripts/write-plugin-sdk-entry-dts.ts`, and related release/build checks.

### 2. Preserve legacy `matrix` config compatibility

- [ ] Make the new `matrix` plugin accept the current public legacy `channels.matrix` schema as-is.
- [ ] Keep support for top-level single-account `channels.matrix.*`.
- [ ] Keep support for `channels.matrix.accounts.*`.
- [ ] Keep support for `channels.matrix.defaultAccount`.
- [ ] Keep support for the legacy `rooms` alias.
- [ ] Keep support for existing DM and group policy keys.
- [ ] Keep support for existing bindings that use `match.channel: "matrix"`.
- [ ] Preserve SecretRef password inputs used by the legacy plugin.
- [ ] Do not require rewriting normal single-account configs into `accounts.default`.
- [ ] Add or keep doctor and startup migrations only for keys that are genuinely obsolete or ignored by the new implementation.
- [ ] Ensure config help, schema labels, and reference docs all describe `channels.matrix`, never `channels.matrix-js`.

### 3. Preserve legacy `matrix` state and runtime behavior

- [ ] Keep `credentials/matrix/credentials*.json` as the credential root.
- [ ] Keep `matrix/accounts/<account>/<homeserver>__<user>/<token-hash>/...` as the canonical runtime and crypto root.
- [ ] Add explicit migration support in the new plugin for direct upgrades from the oldest legacy flat store:
  - [ ] `~/.openclaw/matrix/bot-storage.json`
  - [ ] `~/.openclaw/matrix/crypto/`
- [ ] Do not retain `matrix-js`-path migration logic in the shipped plugin.
- [ ] Preserve multi-account isolation and default-account behavior exactly on the `matrix` channel.
- [ ] Preserve legacy secrets integration by continuing to use the existing `channels.matrix.*` secret collectors and credential surface definitions.
- [ ] Keep route/session binding, ACP binding, thread binding, and outbound message routing keyed to `matrix`, with the current new Matrix functionality carried over.

### 4. Migrate internal Matrix-js-only surfaces to `matrix`

- [ ] Replace every internal channel string and binding string `matrix-js` with `matrix` across ACP binding schemas and runtime.
- [ ] Replace every internal channel string and binding string `matrix-js` with `matrix` across thread binding policy and commands.
- [ ] Replace every internal channel string and binding string `matrix-js` with `matrix` across auto-reply and session context surfaces.
- [ ] Replace every internal channel string and binding string `matrix-js` with `matrix` across agent binding commands and tests.
- [ ] Replace all CLI help, onboarding text, runtime warnings, and verification prompts from `matrix-js` to `matrix`.
- [ ] Rewrite `docs/channels/matrix.md` to describe the new implementation and new verification, ACP, and thread features.
- [ ] Remove `docs/channels/matrix-js.md`.
- [ ] Update shared docs that still reference Matrix-js, including `docs/tools/acp-agents.md`, `docs/tools/subagents.md`, `docs/tools/plugin.md`, and `docs/gateway/configuration-reference.md`.
- [ ] Leave `docs/zh-CN/**` untouched in this pass.

### 5. Automatic messaging and failure handling

- [ ] When startup or doctor rewrites Matrix config, emit a short summary such as:
  - [ ] Matrix plugin upgraded in place
  - [ ] migrated deprecated Matrix config keys
  - [ ] migrated legacy Matrix crypto store
  - [ ] no user action required
- [ ] When automatic repair is not safe, emit exact commands, not generic warnings.
- [ ] For custom or stale local plugin paths, point users to the concrete replacement command or path.
- [ ] Never log secrets or token values in migration output.
- [ ] If a legacy state migration fails, continue with clear non-fatal messaging and tell the user what functionality may be degraded until they re-verify.

## Test plan and acceptance criteria

### Config compatibility

- [ ] Existing `channels.matrix` single-account config loads unchanged.
- [ ] Existing `channels.matrix.accounts.*` config loads unchanged.
- [ ] Existing `channels.matrix.defaultAccount` behavior is preserved.
- [ ] Existing SecretRef password config continues to validate and resolve.
- [ ] Deprecated Matrix-only keys are auto-repaired by startup and doctor with clear change reporting.

### State compatibility

- [ ] Current canonical `credentials/matrix/*` credentials are reused with no prompt.
- [ ] Current canonical `matrix/accounts/*` runtime state is reused with no prompt.
- [ ] Oldest flat legacy Matrix crypto and sync store is migrated automatically to account-scoped storage.
- [ ] Multi-account state remains isolated after migration.

### Plugin and install compatibility

- [ ] Existing npm-installed `@openclaw/matrix` updates in place and remains enabled.
- [ ] `plugins.installs.matrix` continues to update correctly after the cutover.
- [ ] Stale custom path installs are detected and produce exact repair messaging.

### Public surface

- [ ] `openclaw matrix ...` exposes the verification and account commands that the new Matrix implementation owns.
- [ ] `matrix.verify.*` gateway methods work.
- [ ] All bindings, ACP, thread, and session flows use `matrix`, not `matrix-js`.
- [ ] No shipped docs, help, schema output, or package exports reference `matrix-js`.

### Regression coverage

- [ ] Startup auto-migration path.
- [ ] Doctor `--fix` Matrix migration path.
- [ ] Update-triggered doctor path.
- [ ] Route bindings and ACP bindings with `match.channel: "matrix"`.
- [ ] Thread binding spawn gating and routing on `matrix`.
- [ ] Plugin install and update records for `matrix`.

### Acceptance criteria

- [ ] A current public Matrix user can update and keep using `channels.matrix` without editing config.
- [ ] Automatic migration covers every deterministic case.
- [ ] Every non-deterministic case produces explicit next steps.
- [ ] No public `matrix-js` surface remains in the shipped product.

## Assumptions and defaults

- Automatic repair policy: startup plus doctor and update.
- Custom plugin installs: warn and explain; do not mutate arbitrary custom paths automatically.
- No backward compatibility for internal `matrix-js` users or `matrix-js` config, package, CLI, or docs surfaces.
- Canonical external identity after release is `matrix` everywhere.
- The replacement preserves current public `matrix` behavior first, then layers in the newer Matrix features without requiring users to opt into a new namespace.
