# 2026-04-27 CI and Desktop Smoke Repair

## Background

The latest `main` runs are failing on commit `97b7ce1a46408947a65e31928616dd3c17a5c8b5`:

- `CI` push run `24952072735` fails in workspace tests.
- `desktop-smoke` scheduled run `24979681000` fails while building the web app for Tauri.

## Goal

Restore the current CI/CD signal for `main` by fixing the root causes visible in the failing GitHub Actions logs.

## Scope

In scope:

- Static migration audit failure in `packages/db`.
- Shared enum drift failure in `packages/shared`.
- Desktop smoke web build failure caused by missing shared package build output.
- Plan/progress documentation for this repair.

Out of scope:

- Broad workflow redesign.
- Unrelated Node.js 20 action deprecation warnings.
- Desktop signing, packaging, or release workflow changes.

## Assumptions

- The failing GitHub Actions logs are the source of truth for this repair.
- The `V25__order_ledger_acknowledgement.sql` reversal block is intended to satisfy rollback hygiene, so the fix should align the audit wording with the repository's existing "Reversal" convention rather than weakening the test broadly.
- `@finsentinel/web` imports built output from `@finsentinel/shared`, so standalone filtered web builds must build shared first.

## Implementation Steps

1. Reproduce the failing package-level tests locally.
   Verify: `pnpm --filter @finsentinel/db test` and `pnpm --filter @finsentinel/shared test` fail for the same reasons as CI.
2. Fix the migration rollback audit and enum count drift.
   Verify: package tests pass.
3. Fix `desktop-smoke` dependency build order.
   Verify: run a Tauri-export web build path that includes shared build output.
4. Run CI-equivalent verification.
   Verify: targeted tests plus root `pnpm typecheck`, `pnpm test`, and relevant build checks pass or any remaining blocker is recorded.

## Verification Approach

- `pnpm --filter @finsentinel/db test`
- `pnpm --filter @finsentinel/shared test`
- `NEXT_PUBLIC_TAURI=1 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080 pnpm --filter @finsentinel/shared build`
- `NEXT_PUBLIC_TAURI=1 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080 pnpm --filter @finsentinel/web build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Progress Log

- 2026-04-27: Inspected latest failing GitHub Actions runs. `CI` fails on `packages/db` migration rollback hygiene and `packages/shared` `AgentEventType` count drift. `desktop-smoke` fails because filtered web build cannot resolve `@finsentinel/shared`.
- 2026-04-27: Reproduced `packages/db` and `packages/shared` failures locally with the same assertions as CI.
- 2026-04-27: Updated the migration audit to ignore comment-only destructive SQL examples, updated the `AgentEventType` drift test to 53 values, and added explicit `@finsentinel/shared` builds before filtered web builds in `desktop-smoke`.
- 2026-04-27: Verified targeted tests and CI-equivalent root checks locally.

## Key Decisions

- Treat `desktop-smoke` as part of the requested CI/CD repair because it is the latest failing scheduled workflow on `main`.
- Keep fixes limited to the failing tests/workflow path.

## Risks and Blockers

- Local full build may surface additional failures after the first CI blockers are fixed.
- macOS Tauri binary build cannot be fully reproduced on this local environment unless the runner toolchain is available.

## Final Outcome

Fixed locally.

Verification passed:

- `pnpm --filter @finsentinel/db test`
- `pnpm --filter @finsentinel/shared test`
- `pnpm --filter @finsentinel/shared build`
- `NEXT_PUBLIC_TAURI=1 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080 pnpm --filter @finsentinel/web build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

Remaining risk: the macOS Tauri binary build portion of `desktop-smoke` still needs a GitHub Actions run after these changes are pushed.
