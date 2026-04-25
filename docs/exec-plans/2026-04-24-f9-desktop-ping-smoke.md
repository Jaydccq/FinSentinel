# F-9: Desktop CI runtime smoke (ping IPC)

Date: 2026-04-24
Status: **Fully landed** 2026-04-24 (two-layer smoke covers the
feasible ground; native-IPC-from-outside-webview stays parked as
documented DevOps work).
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-9](./2026-04-24-deferred-followups.md)

## What landed — two-layer smoke

### Layer 1: IPC dispatch assertion (runs in plain `cargo test`)

`apps/desktop/src-tauri/src/smoke.rs::tests::ping_round_trips_through_ipc`
builds a `tauri::test::mock_builder()` app, registers `ping`, and
drives a real `InvokeRequest → InvokeResponse` through
`get_ipc_response`. Asserts the deserialized body equals `"pong"`.

Proves:

- `tauri::generate_handler!` wiring in `lib.rs` includes `ping`.
- Command dispatch survives the serde round-trip.
- The crate links cleanly (keyring, sqlite-vec, fastembed, etc.) under
  the Tauri test harness.

No xvfb / display / webview needed. Runs in PR-time `cargo test`.

### Layer 2: runtime no-panic smoke (CI workflow)

`apps/desktop/scripts/runtime-smoke.sh` launches the built debug
binary under `xvfb-run` (Linux) / directly (macOS), lets it initialise
for 12 seconds, then SIGTERMs it. The script accepts both `rc=124`
(timeout) and `rc=0` (clean early exit) as success; any other exit or
any `panicked at` string in stderr fails the job.

Wired into `.github/workflows/desktop-smoke.yml`:

- PR-time Ubuntu job: `apt-get install xvfb` + run the smoke after
  `cargo test`.
- Nightly macOS job: skip xvfb (native WindowServer available) + run
  the smoke.

Proves the binary can boot, webview can initialise, and the Rust
setup hook completes without panic on a fresh CI host.

### Layer 3 (residual gap — documented, not blocking)

Driving `invoke('ping')` from _outside_ the webview on a real host
still requires:

- A dev-only page script injected via Tauri's `initializationScript`
  or a custom protocol handler.
- Process orchestration that waits for the webview-ready event before
  dispatching.
- Plumbing the response back through `console.log` + stdout grep, or
  a tiny loopback HTTP listener.

The Layer-1 mock-runtime test already proves IPC wiring is correct,
and Layer-2 proves the real binary boots without panic — Layer-3
covers a narrow remaining slice (did the real webview successfully
dispatch to the real handler?) that's low-risk today and would cost
multiple days of one-off DevOps infra.

## Verification

| Check                                       | Result                       |
| ------------------------------------------- | ---------------------------- |
| `cargo test --lib` (apps/desktop/src-tauri) | 14 passed / 0 failed         |
| `apps/desktop/scripts/runtime-smoke.sh`     | ready for CI (Linux + macOS) |
| `pnpm --filter @finsentinel/web test`       | 85 passed / 0 failed         |

## Progress log

- 2026-04-24: Added `ping` Rust command + direct-call unit test, web
  `pingDesktop()` helper + two vitest cases.
- 2026-04-24: Added Tauri-mock-runtime IPC smoke test
  (`ping_round_trips_through_ipc`) inside `smoke.rs`. Uses
  `tauri::test::mock_builder()` + `get_ipc_response` to exercise the
  full dispatch boundary without xvfb.
- 2026-04-24: Added `apps/desktop/scripts/runtime-smoke.sh` and wired
  it into both PR-time Ubuntu and nightly macOS jobs of
  `desktop-smoke.yml`. Linux job now installs xvfb alongside the
  existing webkit2gtk deps.
