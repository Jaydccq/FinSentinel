# Multi-Agent Runtime V1

## Goal

Deliver v1 of FinSentinel's `research workspace + background runtime + chat` architecture so the product can run a team-based analysis flow, persist team-stage checkpoints, generate broker-neutral order drafts, and require human approval before any real execution.

## Scope

This plan integrates the gaps identified against TradingAgents and the PRDs in `docs/product-specs/` into one concrete implementation sequence.

Locked product decisions:

- Product shape: chat + workspace + background runtime
- Team topology: `Intelligence -> Thesis -> Risk -> Execution Prep -> Human Approval`
- Thesis team internals: `Positive Case || Negative Case -> Thesis Lead`
- Memory model: long-term preference + mid-term strategy + short-term session
- Chat auto-upgrades to tracked runs for heavy analysis
- Checkpoint granularity: team stage
- Output: human-readable report + structured decision object
- Structured execution output: broker-neutral `orderDrafts`
- Real execution always requires human approval
- Retention: long-term, manual archive only
- v1 manual controls: `pause`, `resume`, `approve-execution`

Out of scope for v1:

- Custom DAG/workflow builder
- Role-level checkpointing
- User-edited stage outputs
- Auto execution without approval
- Broker-specific payload generation inside upstream teams
- Desktop-specific UX

## Current Gaps To Close

1. No first-class `analysis_run` / `analysis_stage` / `analysis_artifact` model
2. No team-based orchestration runtime
3. No queue-backed resumable analysis execution
4. No unified context fabric across chat/workspace/schedule
5. No chat auto-upgrade planner
6. No broker-neutral order-draft contract
7. No human approval persistence and UI
8. No workspace view for stage progress, artifacts, and payloads
9. `autonomy` has CRUD but not real execution

## Delivery Strategy

Ship this in 8 milestones. Do not start frontend-heavy work before Milestones 1-4 land; otherwise the UI will crystallize around the wrong runtime model.

## Milestone 1: Shared Contracts And Database Schema

### Outcome

The repo has a canonical shared contract and persistence model for runs, stages, artifacts, approvals, and broker-neutral order drafts.

### Files

- Add `packages/db/src/schema/analysis-runs.ts`
- Add `packages/db/src/schema/analysis-stages.ts`
- Add `packages/db/src/schema/analysis-artifacts.ts`
- Add `packages/db/src/schema/analysis-approvals.ts`
- Update `packages/db/src/schema/index.ts`
- Update `packages/db/src/schema/relations.ts`
- Add migration `packages/db/migrations/V11__add_analysis_runtime_tables.sql`
- Add `packages/shared/src/schemas/analysis.ts`
- Add `packages/shared/src/schemas/order-draft.ts`
- Update `packages/shared/src/schemas/index.ts`
- Extend `packages/shared/src/enums/agent-event-type.ts`
- Extend `packages/shared/src/enums/agent-event-aggregate-type.ts`

### Notes

- `analysis_runs` is the materialized state root
- `analysis_stages` stores team-stage checkpoints only
- `analysis_artifacts` stores stage outputs and generated payloads
- `analysis_approvals` stores execution approval requests and decisions
- `orderDrafts` schema is broker-neutral and validated in shared

### Acceptance

- DB migration applies cleanly
- Shared Zod schemas export without circular deps
- Event enums cover all new analysis lifecycle events

## Milestone 2: Analysis Runtime Foundation

### Outcome

The backend can create, persist, resume, and inspect analysis runs with queue-backed execution.

### Files

- Expand `apps/api/src/analysis/analysis.module.ts`
- Add `apps/api/src/analysis/analysis-run.controller.ts`
- Add `apps/api/src/analysis/analysis-approval.controller.ts`
- Add `apps/api/src/analysis/analysis-run.service.ts`
- Add `apps/api/src/analysis/analysis-checkpoint.service.ts`
- Add `apps/api/src/analysis/analysis-approval.service.ts`
- Add `apps/api/src/analysis/preflight-planner.service.ts`
- Add `apps/api/src/analysis/run-orchestrator.service.ts`
- Update `apps/api/src/queue/queue.constants.ts`
- Add `ANALYSIS_RUN_QUEUE`
- Add `apps/api/src/queue/analysis-run.producer.ts`
- Add `apps/api/src/queue/analysis-run.consumer.ts`
- Update `apps/api/src/queue/queue.module.ts`
- Update `apps/api/src/events/agent-event.service.ts` usage sites as needed

### Notes

- Reuse BullMQ patterns already present in `apps/api/src/queue/`
- Use dual-write: materialized state tables + append-only `agent_events`
- Keep `analysis.controller.ts` lightweight stock streaming path intact; do not break it

### Acceptance

- Can enqueue a run and observe `RUN_QUEUED -> ... -> RUN_COMPLETED`
- Can pause and resume a run
- Can recover from the latest completed team stage

## Milestone 3: Context Fabric

### Outcome

Chat, workspace, schedule, and heartbeat all assemble context through one service, not ad hoc prompt stitching.

### Files

- Add `apps/api/src/analysis/context-fabric.service.ts`
- Add `apps/api/src/analysis/context-complexity.service.ts`
- Update `apps/api/src/chat/chat-compaction.service.ts` to become one input source, not the orchestration owner
- Update `apps/api/src/agent/user-investment-profile.service.ts` integration path
- Update `apps/api/src/agent/agent-brain.service.ts` integration path
- Update `apps/api/src/rag/rag-retrieval.service.ts` call path where needed

### Notes

- Inputs:
  - long-term preference context
  - mid-term strategy context
  - short-term session context
  - retrieval context
- Outputs:
  - prompt-ready context
  - machine-readable shared context
  - complexity estimate for auto-upgrade
- Default auto-upgrade thresholds:
  - `predictedToolCalls >= 6`
  - or `predictedToolRounds >= 3`
  - or `predictedWallClockSec >= 20`

### Acceptance

- Same request context can be assembled for chat, workspace, and scheduled runs
- Complexity evaluation is deterministic and logged

## Milestone 4: Team Orchestrator

### Outcome

The backend runs the locked team topology with team-level handoffs and structured outputs.

### Files

- Add `apps/api/src/analysis/team-registry.ts`
- Add `apps/api/src/analysis/contracts/`
- Add `apps/api/src/analysis/teams/intelligence-team.service.ts`
- Add `apps/api/src/analysis/teams/thesis-team.service.ts`
- Add `apps/api/src/analysis/teams/risk-team.service.ts`
- Add `apps/api/src/analysis/teams/execution-prep-team.service.ts`
- Add `apps/api/src/analysis/teams/human-approval-gate.service.ts`
- Add `apps/api/src/analysis/teams/role-executor.service.ts`

### Notes

- `Intelligence Team` gathers evidence only
- `Thesis Team` runs positive/negative cases in parallel and then converges via `Thesis Lead`
- `Risk Team` produces the system-primary decision object
- `Execution Prep Team` produces broker-neutral `orderDrafts`
- Team outputs must be schema-validated before checkpoint commit

### Acceptance

- A run can execute all four teams in order
- `Thesis Team` parallel branch waits on both cases before lead convergence
- Each completed team produces:
  - structured output JSON
  - human-readable markdown
  - artifact records

## Milestone 5: Chat, Analysis, And Autonomy Entry-Point Integration

### Outcome

All entry points route into the same runtime.

### Files

- Update `apps/api/src/chat/chat.service.ts`
- Update `apps/api/src/agent/agent.service.ts`
- Update `apps/api/src/analysis/analysis.controller.ts`
- Update `apps/api/src/autonomy/schedule.service.ts`
- Update `apps/api/src/autonomy/heartbeat.service.ts`
- Add runtime trigger service under `apps/api/src/autonomy/`

### Notes

- Chat requests stay inline for lightweight exchanges
- Chat auto-upgrades to a tracked run when the preflight planner crosses threshold or the user explicitly requests:
  - complete analysis
  - decision formation
  - order draft generation
- Schedules and heartbeat never bypass the runtime; they enqueue analysis runs

### Acceptance

- Chat returns a `runId` and upgrade reason when auto-upgraded
- Schedule-triggered and heartbeat-triggered runs appear in the same analysis tables

## Milestone 6: Approval And Execution Adapter Boundary

### Outcome

The system can generate validated broker-neutral order drafts and stop at human approval before real execution.

### Files

- Add `apps/api/src/trading/order-draft-mapper.service.ts`
- Add `apps/api/src/trading/order-draft-validator.service.ts`
- Add `apps/api/src/trading/broker-adapters/` or extend existing broker layer
- Update `apps/api/src/trading/unified-trading.service.ts`
- Update `apps/api/src/trading/interfaces/`
- Update `apps/api/src/events/` emitters for approval/execution events

### Notes

- Upstream teams never emit broker-specific payloads
- `Execution Prep Team` emits only neutral drafts
- Approval record is stored in `analysis_approvals`
- After approval:
  - broker adapter maps draft -> execution payload
  - execution payload is emitted as artifact and event

### Acceptance

- Neutral drafts validate against shared schema
- Approval is required before any broker execution path is called
- Rejected approval leaves the run auditable and resumable

## Milestone 7: Workspace And Approval UX

### Outcome

The frontend has a real analysis workspace with stage progress, artifacts, and right-rail approval.

### Files

- Repurpose `apps/web/src/views/AnalysisPage.tsx` into the workspace root
- Add `apps/web/src/components/analysis/RunSetupPanel.tsx`
- Add `apps/web/src/components/analysis/LiveProgressPanel.tsx`
- Add `apps/web/src/components/analysis/ArtifactsPanel.tsx`
- Add `apps/web/src/components/analysis/FinalReportPanel.tsx`
- Add `apps/web/src/components/analysis/HumanApprovalRail.tsx`
- Update `apps/web/src/views/ChatPage.tsx`
- Update `apps/web/src/views/AutonomyPage.tsx`
- Update `apps/web/src/api/chat.ts`
- Add `apps/web/src/api/analysis.ts` run/approval endpoints as needed

### Notes

- `ChatPage` should surface an `Open Run` jump when auto-upgrade happens
- Approval UX uses a fixed right-rail panel, not a blocking modal
- Workspace must display:
  - team-stage progress
  - artifacts
  - human report
  - structured decision object
  - execution payload preview
  - alert payload preview
  - strategy archive payload preview

### Acceptance

- User can start a run from workspace
- User can inspect completed team artifacts
- User can approve execution from the approval rail
- User can reopen historical runs

## Milestone 8: Hardening, Tests, And Rollout

### Outcome

The v1 system is testable, observable, and safe to ship behind a feature flag.

### Files

- Add API tests under `apps/api/src/analysis/__tests__/`
- Add queue tests under `apps/api/src/queue/__tests__/`
- Add shared schema tests under `packages/shared/src/__tests__/`
- Add web API/state tests under `apps/web/src/api/__tests__/` and view tests where practical
- Add env/config validation for runtime flags

### Test Matrix

- Schema validation for analysis entities and order drafts
- Run enqueue / pause / resume / approval flows
- Thesis parallel branch and convergence
- Chat auto-upgrade trigger behavior
- Schedule and heartbeat enqueue behavior
- Approval-required execution boundary
- Frontend workspace render and approval interaction

### Rollout

- Gate behind `ANALYSIS_RUNS_ENABLED`
- Gate chat auto-upgrade behind `CHAT_AUTO_UPGRADE_ENABLED`
- Keep legacy inline analysis paths available until workspace flow is stable

### Acceptance

- Targeted tests pass
- API typecheck passes
- Workspace API clients compile and basic flows render
- Feature flags allow safe partial rollout

## Dependency Order

1. Shared contracts and DB schema
2. Runtime foundation
3. Context Fabric
4. Team orchestrator
5. Entry-point integration
6. Approval and execution adapter boundary
7. Workspace UX
8. Hardening and rollout

Do not start Milestones 5-7 before 1-4 are stable.

## Progress Log

- 2026-04-16 22:28 ET: Consolidated all identified gaps and product decisions into a single v1 execution plan.
- 2026-04-16 22:28 ET: Chose existing `analysis/`, `queue/`, `trading/`, `shared/`, and `web/views/AnalysisPage.tsx` as the primary implementation anchors instead of inventing a parallel subsystem.
- 2026-04-16 22:28 ET: Locked the execution order around schema -> runtime -> context -> teams -> integration -> approval -> workspace -> hardening.
- 2026-04-16: Broke plan into 4 sub-plans under `docs/superpowers/plans/2026-04-16-runtime-{a,b,c,d}-*.md` (index at `2026-04-16-multi-agent-runtime-v1-index.md`).
- 2026-04-16: Plan A (context foundation) landed — 22 tasks / 15 commits `1246fea..3d0facb`. Shared contracts, 4 Drizzle tables + V11 migration applied, ANALYSIS_RUN_QUEUE + producer/consumer, run/checkpoint/approval/preflight/context-fabric services, REST controllers, feature flags.
- 2026-04-16: Plan B (teams + order drafts) landed — 10 tasks / 9 commits `8d740be..c2e95c0`. Team/role contracts + prompts, RoleExecutor with tool-scope enforcement, 5 team services (Intelligence, Thesis parallel+barrier, Risk, ExecutionPrep, HumanApprovalGate), OrderDraftValidator + Mapper, TeamRegistry wiring, approve-resolve writes EXECUTION_PAYLOAD + completes run.
- 2026-04-16: Plan C (entry points) landed — 7 tasks / 6 commits `8b289c5..851794b`. ChatUpgradePlanner gated by CHAT_AUTO_UPGRADE_ENABLED, AnalysisRuntimeTrigger unified entry, ScheduleRuntime + HeartbeatRuntime @Cron every minute via @nestjs/schedule, AutonomyModule wiring, optional APPROVAL_AUTO_DISPATCH_ENABLED flag.
- 2026-04-16: Plan D (workspace UX + hardening) landed — 6 tasks / 5 commits `6168a17..0bdb84e`. Web analysisRunsApi + analysisApprovalsApi clients, useAnalysisRun polling hook, 5 workspace panels (RunSetup/LiveProgress/Artifacts/FinalReport/HumanApprovalRail), AnalysisPage workspace rewrite with `?runId=` deep link, ChatPage Open Run banner, AutonomyPage recent runs, legacy /analysis/stream gated behind ANALYSIS_RUNS_ENABLED, integration-test skeleton + rollout runbook.
- 2026-04-16: v1 verification: shared + db + api + web typechecks clean; 217 shared tests / 833 api tests / 29 web tests all pass; 3 pre-existing integration test files still fail due to missing live infra (unchanged baseline). Feature flags default OFF — safe to merge.

## Exit Criteria

This plan is complete when the repo supports the following end-to-end path:

1. User asks for a full analysis in chat
2. Chat auto-upgrades to a tracked run
3. Runtime executes the four-team flow with team checkpoints
4. Workspace shows live progress and artifacts
5. System emits structured decision objects and neutral order drafts
6. User approves execution in the approval rail
7. Broker adapter generates real execution payloads
8. Run and artifacts remain queryable for long-term retention and manual archive
