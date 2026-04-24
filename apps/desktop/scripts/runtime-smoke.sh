#!/usr/bin/env bash
# F-9 runtime smoke — launches the built Tauri binary briefly to prove
# it initializes without panicking on a fresh host.
#
# What this does (and doesn't):
#   ✓ Launches the debug binary under xvfb-run on Linux (headless
#     display). Lets it start, sets a 12-second timeout, kills it.
#   ✓ Exits 0 if the binary survived long enough for the webview to
#     register + pulled through the Tauri setup hook without panicking
#     (proven by the absence of "panicked at" in stderr).
#   ✗ Does NOT execute IPC from outside the webview — that path is
#     covered by the `cargo test --lib` mock-runtime assertion in
#     `apps/desktop/src-tauri/src/smoke.rs::ping_round_trips_through_ipc`.
#     A real-webview IPC harness needs a full Tauri updater + dev
#     server orchestration, which is its own DevOps task.
#
# Usage:
#   apps/desktop/scripts/runtime-smoke.sh [--binary <path>]
#
# Exit codes:
#   0  - binary ran for the timeout window without panic
#   1  - binary panicked OR launch failed
#   2  - prerequisite missing (xvfb / binary)
#
# Intended for CI. Locally on macOS this script skips xvfb (macOS has a
# WindowServer) and runs the binary directly.

set -euo pipefail

BINARY=""
TIMEOUT_SECS="${SMOKE_TIMEOUT_SECS:-12}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)
      BINARY="$2"; shift 2 ;;
    --timeout)
      TIMEOUT_SECS="$2"; shift 2 ;;
    *)
      echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Default binary lookup: debug build on the local host.
if [[ -z "$BINARY" ]]; then
  repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
  case "$(uname -s)" in
    Linux)   BINARY="$repo_root/apps/desktop/src-tauri/target/debug/finsentinel-desktop" ;;
    Darwin)  BINARY="$repo_root/apps/desktop/src-tauri/target/debug/finsentinel-desktop" ;;
    *)       echo "unsupported OS: $(uname -s)" >&2; exit 2 ;;
  esac
fi

if [[ ! -x "$BINARY" ]]; then
  echo "[F-9 smoke] binary not found or not executable: $BINARY" >&2
  echo "[F-9 smoke] hint: run 'pnpm --filter @finsentinel/desktop tauri build --debug --no-bundle' first" >&2
  exit 2
fi

# Capture stderr to a log we can grep for panics.
LOG="$(mktemp -t finsentinel-smoke.XXXXXX)"
trap 'rm -f "$LOG"' EXIT

echo "[F-9 smoke] launching $BINARY (timeout=${TIMEOUT_SECS}s)"

run_with_timeout() {
  # macOS ships BSD timeout via `gtimeout` only when coreutils is
  # installed; fall back to a background-kill pattern otherwise.
  if command -v timeout >/dev/null 2>&1; then
    timeout -s TERM "$TIMEOUT_SECS" "$@" || rc=$?
    return "${rc:-0}"
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout -s TERM "$TIMEOUT_SECS" "$@" || rc=$?
    return "${rc:-0}"
  fi
  # Portable fallback: run in background, sleep, kill.
  "$@" &
  local pid=$!
  sleep "$TIMEOUT_SECS"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    return 124   # mimic timeout's exit code
  fi
  wait "$pid"
  return $?
}

set +e
if [[ "$(uname -s)" == "Linux" ]]; then
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "[F-9 smoke] xvfb-run not found — install via: apt-get install -y xvfb" >&2
    exit 2
  fi
  run_with_timeout xvfb-run -a "$BINARY" 2>"$LOG"
else
  run_with_timeout "$BINARY" 2>"$LOG"
fi
rc=$?
set -e

# Timeout (124) is the EXPECTED outcome — we want the binary to run
# past the timeout, not exit early. Any other non-zero code means it
# crashed. Panic text is definitive regardless of exit code.
if grep -q "panicked at" "$LOG"; then
  echo "[F-9 smoke] DETECTED PANIC:" >&2
  grep "panicked at" "$LOG" >&2
  echo "--- full log ---" >&2
  cat "$LOG" >&2
  exit 1
fi

if [[ "$rc" -eq 124 || "$rc" -eq 143 ]]; then
  echo "[F-9 smoke] OK — binary ran for ${TIMEOUT_SECS}s without panic."
  exit 0
fi

if [[ "$rc" -eq 0 ]]; then
  echo "[F-9 smoke] binary exited cleanly (rc=0) before the timeout. Accepting."
  exit 0
fi

echo "[F-9 smoke] binary exited with rc=$rc before the timeout; dumping log." >&2
cat "$LOG" >&2
exit 1
