# V1 Integration-Test Triage

Date: 2026-04-16
Baseline commit: b800c3b (chore: market/research API improvements + deps)
Current commit: 38739c83a8f1d4070425940432e8ad3e416a250a

## Summary

All 3 failing integration tests are regressions: they passed at baseline (86 test files, 788 tests, 0 failures) and fail at HEAD with the same NestJS dependency-injection error introduced by the Plans A–D v1 runtime work.

## Per-Test Analysis

### auth-flow.integration.spec.ts

- Baseline result: **PASS** (included in the 86 test files that passed at b800c3b)
- Current result: **FAIL** — `Error: Nest can't resolve dependencies of the RoleExecutorService (?, ROLE_EXECUTOR_LLM, CONFIGURATION(ai)). Please make sure that the argument ToolRegistry at index [0] is available in the AnalysisModule module.`
- Verdict: **regression**
- Root cause: `createTestApp()` boots the full `AppModule`, which now includes `AnalysisModule`. `AnalysisModule` registers `RoleExecutorService`, which injects `ToolRegistry` by class. `AgentModule` (which `AnalysisModule` imports via `forwardRef`) provides `ToolRegistry` as a provider but does not include it in its `exports` array, so NestJS cannot satisfy the dependency from outside the module. The NestJS application fails to bootstrap, so all integration tests in this file error before any test body runs.
- Responsible v1 commit: **6e494c3** (`feat(analysis): TeamRegistry wires 5 team executors into RunOrchestrator + module wiring`) — this commit added `RoleExecutorService` to `AnalysisModule.providers` without exporting `ToolRegistry` from `AgentModule`.

### chat-stream.integration.spec.ts

- Baseline result: **PASS** (included in the 86 test files that passed at b800c3b)
- Current result: **FAIL** — same error as auth-flow: `Nest can't resolve dependencies of the RoleExecutorService (?, ROLE_EXECUTOR_LLM, CONFIGURATION(ai)). Please make sure that the argument ToolRegistry at index [0] is available in the AnalysisModule module.`
- Verdict: **regression**
- Root cause: Identical to auth-flow — all 3 files share `createTestApp()` which imports `AppModule`, and the bootstrap fails at DI resolution before any test can run.
- Responsible v1 commit: **6e494c3** (same commit — single root cause affects all 3 files)

### trading-flow.integration.spec.ts

- Baseline result: **PASS** (included in the 86 test files that passed at b800c3b)
- Current result: **FAIL** — same error as above: `Nest can't resolve dependencies of the RoleExecutorService (?, ROLE_EXECUTOR_LLM, CONFIGURATION(ai)). Please make sure that the argument ToolRegistry at index [0] is available in the AnalysisModule module.`
- Verdict: **regression**
- Root cause: Identical to the other two files.
- Responsible v1 commit: **6e494c3** (same commit)

## Root Cause Detail

The fix is a one-liner in `apps/api/src/agent/agent.module.ts`: add `ToolRegistry` to the `exports` array. This makes `ToolRegistry` visible to any module that imports `AgentModule` (i.e., `AnalysisModule`). The change carries no behavior risk since `ToolRegistry` is already used internally and its public interface is stable.

**File to fix:** `apps/api/src/agent/agent.module.ts`, `exports` array — add `ToolRegistry`.

```
// Current:
exports: [
  AgentService,
  StockAnalysisService,
  AgentBrainService,
  UserInvestmentProfileService,
  NewsAnalysisService,
  TwitterToolsService,
  CryptoToolsService,
],

// Fixed:
exports: [
  ToolRegistry,         // ← add this
  AgentService,
  StockAnalysisService,
  AgentBrainService,
  UserInvestmentProfileService,
  NewsAnalysisService,
  TwitterToolsService,
  CryptoToolsService,
],
```

## Decision

- Pre-existing failures: **0** — none of the 3 tests were failing at baseline.
- Regressions: **3** — all routed to Task 3 for immediate fix.
- Single root commit: **6e494c3** — the fix is entirely contained in `AgentModule.exports`.

## Logs

- Baseline run log: `/tmp/integration-baseline.log` (86 files pass, 0 failures)
- Current HEAD run log: `/tmp/integration-current.log` (3 files fail, 105 files pass)

## Local Smoke Test Follow-up (Task 2)

**Status:** PARTIAL — blocked by pre-existing repo-level bug.

Date: 2026-04-17
Attempted commits: 7509fab (ToolRegistry export) + 286c2fd (Date/INSERT hygiene) + 203b959 (revert raw-SQL)

### What worked
- V11 migration applied to local PG (4 new tables confirmed).
- API boots cleanly with `ANALYSIS_RUNS_ENABLED=true CHAT_AUTO_UPGRADE_ENABLED=true`.
- All analysis routes mapped (`POST /api/analysis/runs`, `:id/stages`, `:id/artifacts`, `:id/approvals`).
- `TeamRegistry` wires 5 team executors on boot (confirmed in logs).
- `AnalysisRunConsumer` + `ScheduleRuntimeService` + `HeartbeatRuntimeService` register.
- Login to `/api/auth/login` returns a JWT.
- HeartbeatRuntime tick no longer blows up (Date ISO fix in commit `286c2fd`).
- Unit test suite stays green at 853/855 (unchanged).

### What's blocked
- `POST /api/analysis/runs` returns 500.
- Root cause: Drizzle 0.44.7 + postgres.js 3.4.8 scramble bind parameters
  on every INSERT that mixes `default` keywords with `$N` placeholders.
  This breaks `agent_events` (seq_no is GENERATED ALWAYS AS IDENTITY so
  we can't remove the last `default`) AND `news_items` (observed in
  parallel crash), AND the `LocalUserSeeder` (confirmed via hard deletion
  + restart showing the seeder logs "Refreshed" while the DB row doesn't
  exist — the INSERT silently failed).
- Even the workaround path `db.execute(sql\`...\`)` in raw mode produced
  the same bind error — Drizzle still routes through postgres.js prepared
  statements.
- This is a REPO-WIDE issue, not a v1 regression. The `LocalUserSeeder`
  file carries a comment documenting it.

### Required next step (not done in v1)
Either:
1. Pin/upgrade postgres.js to a version that accepts Date/mixed-default
   without scrambling (likely 3.5+).
2. Swap Drizzle's postgres.js driver for `pg` (node-postgres).
3. Write every mutation via raw Postgres client bypassing Drizzle's
   prepared-statement layer entirely.

Option 1 is lowest risk. Options 2/3 are structural.

### Takeaway for v1 ship decision
- V1 code on `main` is type-correct and unit-tested.
- Staging deploys won't hit this bug IF staging uses a version of
  postgres.js / Drizzle that doesn't have the scramble. Track the
  versions in staging before flipping `ANALYSIS_RUNS_ENABLED=true`.
- Local dev smoke test remains blocked until the driver upgrade lands.

## Smoke Test Progress (post postgres 3.4.9 upgrade)

**Status:** Pipeline reaches the LLM stage but LLM response parsing + retry idempotency remain as v1.1 gaps.

### What the postgres 3.4.9 upgrade actually fixed
- The "Date binding" theory was partially right but the real culprit
  was the `agent_events.seq_no` column in the *native* Postgres (not
  Docker): it was `NOT NULL bigint` without `GENERATED ALWAYS AS
  IDENTITY`, so every insert hit a null-constraint violation. Fixed
  by `ALTER TABLE agent_events ALTER COLUMN seq_no ADD GENERATED
  ALWAYS AS IDENTITY`.
- Old CHECK constraints on `agent_events` pinned the v0 enum set
  (CHAT_SESSION, TRADE_WALLET, etc.) and rejected our new
  `ANALYSIS_RUN` aggregate + `RUN_QUEUED` events. Dropped both.
- postgres.js 3.4.9 (from 3.4.8) reduced but did not fully eliminate
  the mixed-default scramble. Supplying every nullable column
  explicitly in our INSERTs (AnalysisRunService, AnalysisCheckpointService,
  AgentEventService) is still required.
- BullMQ v5 rejects `:` in job IDs — switched to `-`.
- **Gotcha:** two Postgres instances on localhost:5432 (native
  Homebrew + Docker). The API connects to the native one; psql via
  `docker compose exec` hits the other. All debugging must use
  `psql "postgresql://postgres:123456@localhost:5432/finsentinel"`
  directly.

### Confirmed working end-to-end on localhost
- `POST /api/analysis/runs` → 201 with run row in `analysis_runs`
- `agent_events.RUN_QUEUED` insert succeeds
- Preflight job picks up, `markRunning` transitions the run
- `EXECUTE_STAGE(INTELLIGENCE)` job fires; `startStage` inserts row
- ContextFabric adapters (user profile / brain / rag) gracefully
  degrade — empty strings when their own service-level inserts fail.
  Not blocking.
- `IntelligenceTeamService.execute` starts, calls OpenRouter

### Remaining v1.1 gaps (not blockers for architecture, but blockers for full E2E)
1. **Role output parsing too strict.** `RoleExecutorService.parseStructured`
   only looks for a fenced ```json block. With our default OpenRouter
   model, the response is free-form text. Options:
   - Use `generateObject` + Zod schema (AI SDK supports structured output).
   - Fall back to extracting the first top-level `{...}` when no fence.
   - Force the model via `response_format: { type: 'json_object' }` in
     the OpenAI-compatible API call.
2. **Retry idempotency.** BullMQ retries `execute-stage` up to 3×.
   `startStage` inserts into `analysis_stages(run_id, stage_key)` which
   has a unique index, so the retry fails on conflict. Options:
   - `ON CONFLICT (run_id, stage_key) DO UPDATE SET status='RUNNING', started_at=NOW()`
   - Or check `findByStage` first and UPDATE if exists.
3. **Failing runs don't get rescheduled cleanly.** After 3 attempts,
   the run is stuck in `FAILED` status with no path to retry.

### Decision
These are discovered-during-real-runtime gaps, not v1 regressions.
Ship v1 code as-is behind `ANALYSIS_RUNS_ENABLED=false`; schedule a
v1.1 milestone to address the 3 gaps above.
