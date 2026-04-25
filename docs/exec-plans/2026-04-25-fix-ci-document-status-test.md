# Fix CI DocumentStatus Test

Date: 2026-04-25
Status: Complete

## Background

GitHub Actions CI on `origin/main` failed in run `24938065468` after the
live-trading guards merge. The failing job is `validate`, step `Test`.

Failure:

- Package: `@finsentinel/shared`
- File: `packages/shared/src/enums/__tests__/enums.test.ts`
- Assertion: `DocumentStatus` expected 4 values, received 5

`DocumentStatus.PENDING_UPLOAD` is already present in
`packages/shared/src/enums/document-status.ts` and documented by the F-4
document outbox plan, so the enum is intentional and the test is stale.

## Goal

Restore CI by updating the shared enum regression test to match the current
versioned enum contract.

## Scope

- Update only the stale `DocumentStatus` test.
- Do not change enum values or application behavior.
- Record verification results here.

## Assumptions

- `PENDING_UPLOAD` is an intentional state, not an accidental enum expansion.
- The CI failure is reproducible locally via the shared package test.

## Implementation Steps

1. Update `DocumentStatus` count and explicit status assertions.
   Verify: `pnpm --filter @finsentinel/shared test`
2. Run broader CI-relevant test command if the targeted check passes.
   Verify: `pnpm test`
3. Run workspace type checking and build after tests pass.
   Verify: `pnpm typecheck` and `pnpm build`

## Verification Approach

Use the same package test surface that failed in GitHub Actions first, then run
workspace tests to catch any newly exposed failures.

## Progress Log

- 2026-04-25: CI failure inspected via `gh run view 24938065468 --log`.
  Root cause identified as stale `DocumentStatus` enum count.
- 2026-04-25: Updated the stale `DocumentStatus` test to include
  `PENDING_UPLOAD` and the 5-value enum count.
- 2026-04-25: Verified with `pnpm --filter @finsentinel/shared test`,
  `pnpm test`, `pnpm typecheck`, and `pnpm build`.

## Key Decisions

- Treat `PENDING_UPLOAD` as part of the shared contract because it is present
  in code and documented by the document outbox execution plan.

## Risks And Blockers

- No remaining blockers for this CI failure.

## Final Outcome

CI failure `24938065468` was caused by a stale shared enum test. The test now
matches the current `DocumentStatus` contract and local CI-equivalent checks
pass.
