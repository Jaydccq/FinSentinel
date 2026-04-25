# F-2 + F-3: Remove env-bake login + legacy localStorage migration

Date: 2026-04-24
Status: Completed 2026-04-24
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-2, §F-3](./2026-04-24-deferred-followups.md)
Blocked on: F-1 (keychain commands) — landed in commit `31aa4d7`.

## Goal

Deliver F-2 (remove `NEXT_PUBLIC_LOCAL_USER_*` build-bake) and F-3 (one-shot
localStorage → keychain migration shim) in a single branch. They share the
same file and F-3 is a three-line add on top of F-2's restructure.

## What landed

### F-2

- `apps/web/src/lib/auth/local-login.ts`:
  - Deleted `isLocalLoginEnabled()` and the env-based creds read inside the
    old `performLogin`.
  - Replaced with public `submitLogin(username, password, apiBase?)` that
    callers (a future login UI, existing AuthContext, etc.) invoke
    explicitly with runtime-supplied credentials. Sets `X-Client: desktop`
    so the backend returns the JWT in the body.
  - `ensureLocalToken` no longer auto-logs-in — it only reads the cached
    token (keychain under Tauri, localStorage otherwise) and returns `null`
    if absent. Callers are responsible for surfacing a login prompt.
- `apps/web/.env.example`: removed `NEXT_PUBLIC_LOCAL_USER_USERNAME/PASSWORD`.
- `apps/web/src/providers.tsx`: comment refresh — no behavior change.

### F-3

- `apps/web/src/lib/auth/local-login.ts::migrateLegacyTokenIfAny`:
  - On the first `ensureLocalToken` call under Tauri, if
    `localStorage.fs_local_token` exists, write it into the keychain via
    `invoke('write_token')` and clear the localStorage slot. Guarded by
    a module-level `legacyShimDone` flag so it runs at most once per page
    load.
- New runbook: [docs/runbooks/2026-04-24-f3-localstorage-shim-removal.md](../runbooks/2026-04-24-f3-localstorage-shim-removal.md)
  schedules the shim deletion for release N+2.

## Out of scope (explicit deferrals)

1. **Login UI**. The plan's step 4 describes "首次启动如果 keychain 没有 token
   弹出登录窗". `submitLogin` is the building block, but the actual React
   form that calls it is a separate product decision (and beyond 0.5-day
   scope). Until then, developers can seed a token manually via a REST
   call during local dev. Tracked as a follow-up to this PR.
2. **Desktop `.env.example` in apps/desktop/**: no such file exists today.

## Verification

| Check                                           | Result                                       |
| ----------------------------------------------- | -------------------------------------------- |
| `pnpm --filter @finsentinel/web test`           | 83 passed / 0 failed                         |
| `pnpm --filter @finsentinel/web typecheck`      | clean                                        |
| `grep -r NEXT_PUBLIC_LOCAL_USER` in active code | only the history comment in `local-login.ts` |

## Progress log

- 2026-04-24: branch `feat/2026-04-24-f2-f3-keychain-migration` cut from
  post-F-1 main. env references removed, `submitLogin` extracted,
  migration shim added, 5 new test cases (3 URL composition + 1 browser
  no-auto-login + 1 F-3 migration). Runbook drafted.
