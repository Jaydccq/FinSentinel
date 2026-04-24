# F-1: Tauri Rust keychain integration

Date: 2026-04-24
Status: In progress
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-1](./2026-04-24-deferred-followups.md#f-1-桌面端-keychain-tauri-rust-端)
Upstream PRD: `docs/product-specs/2026-04-23-auth-session-hardening.md` §5.4

## Background

The 2026-04-23 auth-session-hardening PRD landed P0-3 (cookie/CORS/registration race/X-Client header), but left the desktop credential store on `window.localStorage.fs_local_token`. Anything resident in localStorage is readable by any script that reaches the webview context — unacceptable for a shipped desktop app. The follow-ups tracker flags this as a P0 blocker for F-2 (build-bake removal) and F-3 (compat shim).

## Goal

Move the desktop JWT out of localStorage into the OS keychain via three new Tauri Rust commands, with a browser-safe fallback path that remains untouched.

| Surface | Before F-1 | After F-1 |
|---------|-----------|-----------|
| Web build (SPA, non-Tauri) | `localStorage.fs_local_token` | unchanged |
| Tauri desktop | `localStorage.fs_local_token` | OS keychain via Rust commands |
| Linux without Secret Service | — | `session_only` error → in-memory only |

## Scope

In scope:
- `apps/desktop/src-tauri/Cargo.toml`: add `keyring = "3"` per-platform
- New Rust module `apps/desktop/src-tauri/src/auth.rs` with `read_token` / `write_token` / `clear_token` commands
- Register commands in `src-tauri/src/lib.rs`
- `apps/web/src/lib/auth/local-login.ts`: branch on `isTauri()` to use keychain path
- Tests: web side asserts localStorage is not touched under Tauri; Rust side ships with a mock-backed round-trip test (gated).

Out of scope (deferred to F-2/F-3):
- Removing `NEXT_PUBLIC_LOCAL_USER_*` build-bake.
- localStorage → keychain migration shim.
- Replacing env-driven auto-login with a UI login flow.

## Assumptions

1. Tauri v2 runtime — `isTauri()` already uses `__TAURI_INTERNALS__`, not `__TAURI__`. Plan text ("window.__TAURI__") pre-dates this refactor.
2. `keyring-rs` 3.x is stable for macOS/Windows; Linux uses `sync-secret-service` (libsecret at build time). Tauri v2 Linux bundles already require libsecret via WebKit2GTK stack, so this adds no new system dep on dev boxes.
3. Existing `ensureLocalToken` callers (`apps/web/src/providers.tsx`, `apps/web/src/api/client.ts`) stay sync-compatible via a module-level in-memory cache primed at boot.

## Success criteria

- `pnpm --filter @finsentinel/web test` passes including new Tauri-path cases that stub `@tauri-apps/api/core` `invoke`.
- `pnpm --filter @finsentinel/web typecheck` clean.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` clean on host (macOS).
- `grep -n 'localStorage.getItem.*fs_local_token\|localStorage.setItem.*fs_local_token' apps/web/src/lib/auth/local-login.ts` reports only browser-build branches.

## Implementation steps

1. Add `keyring` dependency (target-specific) to `apps/desktop/src-tauri/Cargo.toml`.
2. Create `apps/desktop/src-tauri/src/auth.rs` with:
   - `SERVICE = "finsentinel-desktop"`, `USER = "jwt"`.
   - `read_token` → `Ok(Some(String)) | Ok(None) | Err("session_only" | "io")`.
   - `write_token(token)`, `clear_token`.
   - Linux / missing-backend failures map to the `session_only` sentinel.
3. Register commands in `src-tauri/src/lib.rs` `invoke_handler`.
4. `apps/web/src/lib/auth/local-login.ts`:
   - Add `readKeychainToken()` / `writeKeychainToken(t)` / `clearKeychainToken()` using dynamic `import('@tauri-apps/api/core')` (mirrors `private-docs.ts`).
   - Keep a module-level `inMemoryToken` cache. `getCachedToken()` returns it when in Tauri; falls back to `localStorage` otherwise.
   - `performLogin` / `ensureLocalToken` branch on `isTauri()`.
5. `apps/web/src/lib/auth/__tests__/local-login.test.ts`:
   - Add a describe block that stubs `window.__TAURI_INTERNALS__` and mocks `@tauri-apps/api/core` `invoke`. Asserts write goes through `invoke('write_token', { token })`, and localStorage remains empty.
6. Verify.

## Verification

| Check | Command |
|-------|---------|
| Rust compiles | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` |
| Web tests | `pnpm --filter @finsentinel/web test` |
| Web typecheck | `pnpm --filter @finsentinel/web typecheck` |
| No direct localStorage leak in Tauri path | `grep -n 'fs_local_token' apps/web/src/lib/auth/local-login.ts` |

## Risks / blockers

- libsecret on Linux CI runners: desktop-smoke currently runs only Ubuntu for PR builds (`desktop-smoke.yml`). If `cargo check` in F-1.5 surfaces libsecret link errors, we’ll fallback to `async-secret-service` or ship a build-time apt install step in the workflow.
- Rust-side unit test flakiness — GitHub Actions runners often lack an unlocked keychain. Tests will use `keyring`'s `mock` feature where feasible; otherwise gated behind `cfg(feature = "keyring-live-tests")`.

## Progress log

- 2026-04-24: branch `feat/2026-04-24-f1-tauri-keychain` created. Plan scaffolded.
- 2026-04-24: Rust side landed.
  - `apps/desktop/src-tauri/Cargo.toml` gained per-platform `keyring` 3 deps (apple-native / windows-native / sync-secret-service).
  - New `apps/desktop/src-tauri/src/auth.rs` with `read_token` / `write_token` / `clear_token` Tauri commands. Errors classified into `not_found` / `session_only` / `io` sentinels.
  - `src-tauri/src/lib.rs` registers the three new commands in `invoke_handler`.
  - Decision: no `cfg(test)` unit tests. `keyring` v3 dropped the `mock` feature; exercising the real OS keychain from `cargo test` is flaky (macOS CI has a locked keychain by default). Runtime round-trip validation moves to F-9's IPC smoke.
- 2026-04-24: Web side landed.
  - `apps/web/src/lib/auth/local-login.ts` branches on `isTauri()`:
    - Tauri path uses dynamic `import('@tauri-apps/api/core')` to invoke `read_token` / `write_token` / `clear_token`.
    - Added module-level `memoryToken` cache so `getCachedToken()` stays sync for `authHeaders()` callers (client.ts, providers.tsx — call sites unchanged).
    - `session_only` and `io` keychain errors swallow gracefully → in-memory token only, no durable persistence.
  - `apps/web/src/lib/auth/__tests__/local-login.test.ts` gained four new cases under a `Tauri keychain path` describe: cached keychain read, fresh login write, session-only fallback, and clearCachedToken invoking `clear_token` while leaving legacy localStorage alone (that removal is F-3's scope).
- 2026-04-24: Verification complete.
  - `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` → 0 warnings, 0 errors.
  - `pnpm --filter @finsentinel/desktop test` (cargo test) → 12 passed / 0 failed.
  - `pnpm --filter @finsentinel/web test` → 79 passed / 0 failed (incl. 4 new Tauri-path cases).
  - `pnpm --filter @finsentinel/web typecheck` → clean.

## Final outcome

F-1 delivered. Tauri keychain path is live; Web browser builds remain on localStorage (intentional — removal is F-2). Follow-ups F-2 and F-3 are now unblocked.

