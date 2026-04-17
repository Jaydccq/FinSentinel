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
