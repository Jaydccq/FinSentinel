# Runbook: F-3 legacy localStorage → keychain shim removal

Date: 2026-04-24
Status: Scheduled
Related exec plan: [2026-04-24-f1-tauri-keychain.md](../exec-plans/2026-04-24-f1-tauri-keychain.md)
Related follow-ups: [2026-04-24-deferred-followups.md §F-3](../exec-plans/2026-04-24-deferred-followups.md)

## Purpose

F-3 landed a one-shot migration that reads `localStorage.fs_local_token`
on first boot under Tauri, writes it into the OS keychain via
`invoke('write_token', { token })`, then clears the localStorage slot.
Location: `apps/web/src/lib/auth/local-login.ts` → `migrateLegacyTokenIfAny`.

This shim only exists to bridge users of the pre-F-1 release (where the
token lived in localStorage) onto the keychain path without forcing a
re-login. It must be removed once the majority of active desktop users
have upgraded past the F-1/F-2/F-3 release.

## Schedule

| Release | Behavior |
|---------|----------|
| N (F-1/F-2/F-3 combined) | Shim runs on boot; keychain is the live slot. |
| N+1 | Shim stays — give slow upgraders one more cycle. |
| **N+2** | **Delete `migrateLegacyTokenIfAny` and the `legacyShimDone` flag.** |

## Removal checklist

1. In `apps/web/src/lib/auth/local-login.ts`:
   - Delete the `migrateLegacyTokenIfAny` function.
   - Delete the `legacyShimDone` module-level flag.
   - Remove the `migrated` branch inside `ensureLocalToken`.
2. In `apps/web/src/lib/auth/__tests__/local-login.test.ts`:
   - Delete the `F-3 shim: migrates legacy localStorage token ...` test case.
3. Verify: `pnpm --filter @finsentinel/web test` stays green.
4. Any desktop user who skipped multiple releases and still has a token in
   localStorage will be silently logged out; they go through `submitLogin`
   once to regenerate.

## Detection / rollback

- Signal for "safe to remove": desktop release telemetry shows < 1% of
  boots triggering the `write_token` path during `ensureLocalToken` for
  three consecutive weeks. (Add a one-line `console.info('[F-3] migrated
  legacy token')` before removal and ship a telemetry counter if more
  precision is needed.)
- Rollback: the shim is pure JS, no data destruction. Reverting the commit
  restores the migration path for any stragglers.
