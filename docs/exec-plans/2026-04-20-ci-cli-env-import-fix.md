# CI CLI Env Import Fix

## Background

The API CI test job fails when RAG CLI unit tests import CLI modules that also import `AppConfigModule` from `apps/api/src/config`. `AppConfigModule` validates required environment variables at module load time, so helper-only unit tests fail before they can run when CI does not provide database, Redis, or provider credentials. `golden-candidates.cli.ts` also calls `main()` at module load time, which can trigger `process.exit(1)` during imports.

## Goal

Make RAG CLI unit tests import pure helper functions without requiring CI secrets or bootstrapping NestJS.

## Scope

In scope:
- RAG CLI files under `apps/api/src/rag/**` that import `AppConfigModule` from `../../config`.
- Unit tests that import those CLI helper functions.
- Targeted verification for the failing CI specs and TypeScript validity.

Out of scope:
- Relaxing production environment validation in `src/config/config.module.ts`.
- Changing runtime CLI behavior when the CLI is executed directly.
- Adding default fake credentials to CI.

## Assumptions

- The repository is the source of truth; the CI log points to the affected import path but the fix must be proven locally.
- CLI runtime still needs strict config validation once a CLI actually creates a Nest application context.
- Helper-only tests should not require `DATABASE_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`, or market data credentials.
- Keeping config validation strict is safer than bypassing validation globally when `NODE_ENV=test`.

## Success Criteria

- Importing the listed CLI helper modules with required env vars unset does not execute `main()`, create a Nest context, or validate `AppConfigModule`.
- Runtime CLI execution still checks `DATABASE_URL` before bootstrapping DB-backed commands.
- The failing specs listed in the CI report pass locally.
- Relevant TypeScript checks pass or any remaining blocker is recorded.

## Uncertainties

- CI may also import adjacent RAG CLI modules that were not in the failing list, so the fix should cover the repeated top-level config-import pattern in the RAG CLI surface when it is the same issue.
- Local dependency state may differ from CI; verification should use the repo's package scripts where possible.

## Simplest Viable Path

1. Move Nest bootstrap module construction behind functions that run only from `main()`.
   Verify: importing a CLI helper no longer imports `../../config`.
2. Add entrypoint guards to any unguarded RAG CLI entrypoints.
   Verify: tests can import helpers without `process.exit`.
3. Add a regression test that imports the affected CLI modules with env vars cleared.
   Verify: the test fails before the refactor and passes after.
4. Run the reported failing specs and type checks.
   Verify: commands exit successfully.

## Implementation Steps

1. Create this execution plan.
   Verify: plan file exists under `docs/exec-plans/`.
2. Refactor affected CLI files so runtime-only config imports happen inside `main()`.
   Verify: `rg "from '../../config'" apps/api/src/rag -g '*.cli.ts'` finds no static RAG CLI config imports.
3. Guard unguarded CLI files so importing them in tests never runs `main()`.
   Verify: `rg "main\\(\\)\\.catch" apps/api/src/rag -g '*.cli.ts'` shows calls only behind entrypoint guards.
4. Add regression coverage for import-without-env behavior.
   Verify: targeted Vitest import test passes with env vars cleared.
5. Run targeted tests and typecheck.
   Verify: record command results here.

## Verification Approach

- Targeted Vitest for:
  - `apps/api/src/rag/admin/__tests__/rag-backfill-chunk-issuer-tickers.cli.spec.ts`
  - `apps/api/src/rag/admin/__tests__/rag-reindex-by-doctype.cli.spec.ts`
  - `apps/api/src/rag/admin/__tests__/rag-backfill-representation-sparse.cli.spec.ts`
  - `apps/api/src/rag/eval/__tests__/seed-fixture.cli.spec.ts`
  - `apps/api/src/rag/eval/__tests__/golden-candidates.cli.spec.ts`
- Regression import test covering all RAG CLI modules with static config-import risk.
- `pnpm typecheck` if local dependencies are available.

## Progress Log

- 2026-04-20: Created plan after confirming the failure pattern: helper tests import CLI files; CLI files import `../../config`; `AppConfigModule` validates env at module load.
- 2026-04-20: Refactored RAG CLI bootstrap modules so `AppConfigModule` and `DatabaseModule` are imported dynamically only from direct CLI runtime paths.
- 2026-04-20: Added entrypoint guards to unguarded RAG CLI files so helper imports do not execute `main()`.
- 2026-04-20: Added `apps/api/src/rag/__tests__/cli-import-env.spec.ts` to import RAG CLI modules with required runtime env vars cleared and assert no `process.exit`.
- 2026-04-20: Targeted Vitest command passed: `pnpm --filter @finsentinel/api exec vitest run src/rag/__tests__/cli-import-env.spec.ts src/rag/admin/__tests__/rag-backfill-chunk-issuer-tickers.cli.spec.ts src/rag/admin/__tests__/rag-reindex-by-doctype.cli.spec.ts src/rag/admin/__tests__/rag-backfill-representation-sparse.cli.spec.ts src/rag/eval/__tests__/seed-fixture.cli.spec.ts src/rag/eval/__tests__/golden-candidates.cli.spec.ts` (6 files, 89 tests).
- 2026-04-20: Static check passed: `rg -n "from '../../config'|from \"../../config\"" apps/api/src/rag -g '*.cli.ts'` returned no matches.
- 2026-04-20: Initial `pnpm --filter @finsentinel/api typecheck` failed because current `apps/api/src/config/ai.config.ts` imports new `@finsentinel/ai-runtime` exports that were not present in generated `dist` types. After `pnpm --filter @finsentinel/ai-runtime build`, API typecheck passed.

## Key Decisions

- Keep `AppConfigModule` validation strict. The problem is test imports pulling runtime bootstrap too early, not the schema requiring database and Redis URLs.
- Prefer runtime-only dynamic config import in CLI `main()` paths over global fake env defaults.
- Apply the same runtime-only bootstrap pattern to adjacent RAG CLI files with the same top-level config-import/unguarded-entrypoint shape, not only the five files named in the CI log.

## Risks and Blockers

- Refactoring CLI bootstrap modules must preserve Nest provider wiring exactly for direct CLI execution.
- Direct CLI execution was not smoke-tested because these commands require runtime database/Redis/provider environment. The provider arrays are unchanged; only the time at which the module is constructed changed.
- The workspace contains unrelated AI provider changes in `apps/api/src/config/*`, `apps/api/src/agent/agent.service.ts`, and `packages/ai-runtime/src/*`. API typecheck depends on generated `packages/ai-runtime/dist` types being refreshed after those changes.

## Final Outcome

Fixed. RAG CLI helper imports no longer trigger config validation or process exit when CI lacks runtime env vars. Targeted tests and API typecheck pass after refreshing the current `ai-runtime` build output.
