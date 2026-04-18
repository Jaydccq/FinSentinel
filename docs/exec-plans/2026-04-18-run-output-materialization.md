# Run Output Materialization

## Background

Task 3 added a queue-aware runtime control service and run stream. The remaining runtime foundation gap is run-level output materialization: `analysis_runs.sharedContextJson`, `analysis_runs.decisionObjectJson`, and `analysis_runs.finalReportMarkdown` exist in the schema but completion still only marks the run as `COMPLETED`.

## Goal

When the orchestrator reaches the terminal stage, assemble stage outputs and persist run-level materialized outputs before emitting `RUN_COMPLETED`.

## Scope

In scope:

- `RunReportAssembler` for deterministic final report and decision object assembly.
- `AnalysisRunService.completeWithOutputs`.
- Orchestrator terminal path integration.
- Focused tests for assembler, run persistence, and terminal orchestration.

Out of scope:

- LLM-authored final narrative generation.
- UI replay/report presentation.
- Reworking every stage schema to emit a perfect decision object.

## Assumptions

- Stage structured outputs are partially heterogeneous today, so assembler must be tolerant and return `decisionObject: null` when the candidate object cannot satisfy the shared schema.
- Empty `executionPayload.orderDrafts` is a valid fallback.
- Existing tests that instantiate `RunOrchestratorService` directly should keep working without extra constructor dependencies.

## Implementation Steps

1. Add failing assembler and persistence tests.
   Verify: missing assembler/service methods fail.
2. Implement `RunReportAssembler`.
   Verify: assembler test passes and invalid decision candidates return `null`.
3. Add `AnalysisRunService.completeWithOutputs`.
   Verify: run service test captures materialized DB update and `RUN_COMPLETED` event.
4. Wire orchestrator terminal path to assemble and persist outputs.
   Verify: terminal orchestrator test calls `completeWithOutputs`.
5. Run targeted tests and typecheck.
   Verify: all targeted checks pass.

## Verification Approach

- `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/run-report-assembler.service.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts src/analysis/__tests__/run-orchestrator.service.spec.ts`
- `pnpm --filter @finsentinel/api typecheck`
- `git diff --check`

## Progress Log

- 2026-04-18: Started Task 4 on `codex/runtime-control-stream` after committing Task 3.
- 2026-04-18: Added failing tests for `RunReportAssembler`, `AnalysisRunService.completeWithOutputs`, and approval completion materialization.
- 2026-04-18: Implemented deterministic report assembly, schema-validated decision object extraction, run output persistence, approval completion materialization, and optional orchestrator terminal materialization.
- 2026-04-18: Ran Task 4 targeted tests successfully.
- 2026-04-18: Ran combined Task 3/4 targeted API tests and API typecheck successfully.

## Key Decisions

- Build the report from persisted stage rows and artifacts instead of reconstructing prompt-time state.
- Keep materialization deterministic and schema-validated; do not call an LLM in v1.
- Preserve backward compatibility in tests by making orchestrator materialization dependencies optional.
- Materialize the real approval completion path because current runs complete through `AnalysisApprovalService.resolve(APPROVE)`.

## Risks And Blockers

- Heterogeneous stage outputs mean `decisionObject` may be `null` until downstream stages emit the required full schema.
- Final report quality is deterministic and may be terse compared with a future LLM-generated report.
- `RUN_COMPLETED` is emitted by the final persistence call; callers must avoid calling both `markCompleted` and `completeWithOutputs` for the same completion.

## Final Outcome

Task 4 implemented and verified locally.

Verification passed:

- `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/run-report-assembler.service.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts src/analysis/__tests__/analysis-approval.service.spec.ts src/analysis/__tests__/run-orchestrator.service.spec.ts`
- `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/runtime-control.service.spec.ts src/analysis/__tests__/analysis-stream.controller.spec.ts src/analysis/__tests__/run-orchestrator.service.spec.ts src/events/__tests__/agent-event.service.spec.ts src/analysis/__tests__/analysis-run.controller.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts src/analysis/__tests__/run-report-assembler.service.spec.ts src/analysis/__tests__/analysis-approval.service.spec.ts`
- `pnpm --filter @finsentinel/api typecheck`
- `git diff --check`
