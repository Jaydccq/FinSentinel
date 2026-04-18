# Runtime Control And Live Stream

## Background

Task 1 and Task 2 established the runtime context journal foundation. The next OpenAlice-aligned gap is the runtime control plane and live run timeline. Current run APIs can update pause/resume/cancel status, but `resume` does not enqueue work again and run-level streaming is still missing. Existing `agent_events` already provide the append-only timeline source, so Task 3 should extend that path instead of introducing a second event store.

## Goal

Add a verifiable run runtime control layer and live stream API:

- `resume` must re-enqueue execution through the queue.
- `pause` and `cancel` must gate orchestrator progress, not just update labels.
- `GET /analysis/runs/:id/stream` must replay historical run events and deliver new events over SSE.

## Scope

In scope:

- `RuntimeControlService` for pause/resume/cancel and retry-stage orchestration.
- Run aggregate replay helpers and in-process event fan-out in `AgentEventService`.
- `AnalysisStreamController` for run-level SSE.
- Orchestrator guards for paused/canceled runs.
- Focused tests for service, controller, stream fan-out, and orchestrator gating.

Out of scope:

- Cross-instance Redis pub/sub.
- Frontend timeline UI.
- Final report materialization. That remains Task 4.

## Assumptions

- `main` contains PR #8/#9 and is the clean source branch for Task 3.
- `agent_events` is the canonical timeline store.
- In-process fan-out is acceptable for v1 as long as SSE also replays from DB by cursor.
- Pause cannot interrupt a currently running role mid-call in v1; it gates the next orchestrator step.

## Implementation Steps

1. Add failing tests for runtime control semantics.
   Verify: resume test expects `runs.resume` plus `producer.enqueueResume`; retry-stage validates stage key and enqueues a stage.
2. Add failing tests for aggregate replay and live fan-out.
   Verify: replay filters by aggregate and cursor; subscribers receive appended aggregate events.
3. Add failing tests for stream controller.
   Verify: not-owned run throws; owned run returns replayed events and subscribes using `afterSeqNo`.
4. Add failing tests for orchestrator gating.
   Verify: paused/canceled runs do not execute/enqueue next stage; resume uses current stage.
5. Implement the minimal services/controllers/module wiring.
   Verify: targeted tests pass.
6. Run typecheck and record outcomes.
   Verify: `pnpm --filter @finsentinel/api typecheck` passes.

## Verification Approach

- `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/runtime-control.service.spec.ts src/analysis/__tests__/analysis-stream.controller.spec.ts src/analysis/__tests__/run-orchestrator.service.spec.ts src/events/__tests__/agent-event.service.spec.ts src/analysis/__tests__/analysis-run.controller.spec.ts`
- `pnpm --filter @finsentinel/api typecheck`
- `git diff --check`

## Progress Log

- 2026-04-18: Confirmed primary workspace is clean on `main` after preserving unrelated resume guide changes on `codex/resume-technical-guide`.
- 2026-04-18: Created branch `codex/runtime-control-stream` from clean `main`.
- 2026-04-18: Reviewed current `AnalysisRunService`, `RunOrchestratorService`, `AnalysisRunProducer`, `AgentEventService`, and run controller.
- 2026-04-18: Added failing tests for runtime control re-enqueue, run event replay/live fan-out, stream ownership/cursor handling, and orchestrator pause gating.
- 2026-04-18: Implemented `RuntimeControlService`, `AnalysisStreamController`, aggregate event replay/watch helpers, retry-stage state transition, and orchestrator pause/cancel gates.
- 2026-04-18: Ran targeted API tests successfully.
- 2026-04-18: Built workspace dependency packages and reran API typecheck successfully.

## Key Decisions

- Keep `AnalysisRunService` responsible for persisted run state transitions, and add `RuntimeControlService` as orchestration layer for queue-aware control actions.
- Reuse `agent_events` for stream replay and live delivery instead of creating a separate timeline table.
- Implement live fan-out in memory for v1, with replay-by-cursor as the recovery path.
- Preserve existing `POST /analysis/runs/:id/pause|resume|cancel` routes but route them through `RuntimeControlService`.
- Add `POST /analysis/runs/:id/stages/:stageKey/retry` as the v1 stage retry control route.

## Risks And Blockers

- In-memory stream fan-out does not cross process boundaries.
- Existing BullMQ jobs cannot be forcibly interrupted once a role is already executing.
- The current API package requires dependency package builds before some targeted tests resolve workspace package entrypoints.
- `retryStage` currently supports rerunning from `FAILED`, `PAUSED`, or `WAITING_APPROVAL`; active `RUNNING` retry is rejected.

## Final Outcome

Task 3 implemented and verified locally.

Verification passed:

- `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/runtime-control.service.spec.ts src/analysis/__tests__/analysis-stream.controller.spec.ts src/analysis/__tests__/run-orchestrator.service.spec.ts src/events/__tests__/agent-event.service.spec.ts src/analysis/__tests__/analysis-run.controller.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts`
- `pnpm --filter @finsentinel/shared build`
- `pnpm --filter @finsentinel/db build`
- `pnpm --filter @finsentinel/ai-runtime build`
- `pnpm --filter @finsentinel/api typecheck`
- `git diff --check`
