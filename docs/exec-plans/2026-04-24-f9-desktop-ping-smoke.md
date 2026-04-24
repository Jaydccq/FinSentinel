# F-9: Desktop CI runtime smoke (ping IPC)

Date: 2026-04-24
Status: Minimal slice landed 2026-04-24
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-9](./2026-04-24-deferred-followups.md)

## What landed

1. **Rust `ping` command** in `apps/desktop/src-tauri/src/smoke.rs`. Returns
   the literal `"pong"`. Registered in `lib.rs::invoke_handler`.
2. **Rust unit test** (`ping_returns_pong`) — runs inside
   `pnpm --filter @finsentinel/desktop test` (now 13 passing).
3. **Web-side helper** `pingDesktop()` at
   `apps/web/src/lib/tauri/smoke.ts` plus a two-case vitest spec that
   asserts the `@tauri-apps/api/core` mock contract.

## What was intentionally NOT done

The original plan asked for a *runtime* smoke — launch `tauri dev`,
invoke `ping`, assert no panics / unhandled rejections. That needs:

- A virtual display server on Linux CI (`xvfb-run` + libgl mesa).
- Process orchestration: start the Tauri dev server, wait for webview
  ready, fire an IPC, kill the process, check exit code.
- A way to dispatch IPC from *outside* the webview — none exists
  natively; would need to inject a page script that calls `invoke` and
  reports via stdout, or wire a tiny HTTP listener.

That's a multi-day DevOps work item that isn't blocking anything today.
Left as an explicit follow-up:

> **F-9 follow-up (next wave):** Stand up `apps/desktop/scripts/smoke.ts`
> that uses `@tauri-apps/cli` programmatically to boot the app under
> xvfb and exercises `invoke('ping')` via a dev-only page script. Add
> `pnpm --filter @finsentinel/desktop smoke` and wire it after the
> existing `tauri build --debug --no-bundle` step in
> `.github/workflows/desktop-smoke.yml`.

The slice landed here gives that follow-up a concrete target
(`ping` + `pingDesktop`) so it's a pure orchestration problem.

## Verification

| Check | Result |
|-------|--------|
| `cargo test --lib` (apps/desktop/src-tauri) | 13 passed / 0 failed |
| `pnpm --filter @finsentinel/web test` | 85 passed / 0 failed |
| `pnpm --filter @finsentinel/web typecheck` | clean |

## Progress log

- 2026-04-24: Added `ping` Rust command + unit test, web `pingDesktop()`
  helper + two vitest cases, this exec plan.
