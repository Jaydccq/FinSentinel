# Multi-Agent Runtime V1 — Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** `docs/exec-plans/2026-04-16-multi-agent-runtime-v1.md` + PRDs in `docs/product-specs/`

**Goal:** Ship v1 of FinSentinel's research workspace + background runtime + chat architecture: team-based analysis flow, team-stage checkpoints, broker-neutral order drafts, and human approval before real execution.

**Architecture:** NestJS API with BullMQ-backed `analysis_run` queue. Dual-write persistence (materialized run/stage/artifact tables + append-only `agent_events`). Four-team orchestration (`Intelligence → Thesis → Risk → Execution Prep → Human Approval`) with team-level checkpoints. Chat auto-upgrades to tracked runs when preflight planner crosses thresholds. Next.js workspace shows live stage progress with fixed right-rail approval UX. Broker-neutral `orderDrafts` schema validated in `packages/shared` before any broker adapter mapping.

**Tech Stack:** TypeScript, NestJS, Next.js, Drizzle (Postgres + pgvector), BullMQ (Redis), Zod, Vercel AI SDK (OpenRouter/OpenAI-compatible), Vitest.

---

## Plan Decomposition

Each plan produces working, testable software on its own. Plans are executed in order.

| Order | Plan | Scope | PRDs | Exec-plan milestones |
|-------|------|-------|------|-----------------------|
| A | [Context Foundation](./2026-04-16-runtime-a-context-foundation.md) | DB schema + shared contracts + run/checkpoint/approval services + BullMQ runtime foundation + context fabric | PRD1 (Context Fabric), PRD3 (Runtime §4.1-4.4, §6.1) | M1, M2, M3 |
| B | [Agent Teams Orchestrator](./2026-04-16-runtime-b-team-orchestrator.md) | Team registry + role executor + 4 team services (Intelligence, Thesis-with-parallel-Positive/Negative, Risk, Execution Prep) + HumanApprovalGate + OrderDraft validator/mapper | PRD2 (Teams), portions of PRD3 | M4, M6 |
| C | [Entry-Point Integration](./2026-04-16-runtime-c-entry-points.md) | Chat auto-upgrade planner + runtime trigger in autonomy schedule/heartbeat + unified trading adapter integration | PRD3 (Autonomy §5), portions of PRD1/PRD4 | M5 |
| D | [Workspace UX + Hardening](./2026-04-16-runtime-d-workspace-hardening.md) | AnalysisPage workspace + RunSetupPanel + LiveProgressPanel + ArtifactsPanel + FinalReportPanel + HumanApprovalRail + feature flags + test matrix + rollout runbook | PRD4 (Workspace), PRD3 validation | M7, M8 |

## Dependency Order

```
Plan A (Context Foundation)
    └─> Plan B (Teams Orchestrator)   ──┐
    └─> Plan C (Entry-Point Integration) ┼─> Plan D (Workspace UX + Hardening)
                                         ┘
```

- **Plan A MUST land first.** B and C both depend on the `analysis_runs` / `analysis_stages` tables, the `AnalysisRunService`, the `RunOrchestratorService`, and the `ContextFabricService` defined there.
- **Plans B and C** can be built in parallel after A lands, but B should finish before D (D renders team output artifacts).
- **Plan D** is the last step — it exercises everything above end-to-end.

## Feature Flags (Plan A defines; Plans B–D consume)

- `ANALYSIS_RUNS_ENABLED` — gates new runtime paths. Keep legacy `analysis.controller.ts` stock-streaming path alive until D lands.
- `CHAT_AUTO_UPGRADE_ENABLED` — gates Plan C's chat auto-upgrade logic.

## Locked v1 Decisions (from exec plan + PRDs)

- Team topology: `Intelligence → Thesis → Risk → Execution Prep → Human Approval`.
- Thesis internals: `Positive Case ∥ Negative Case → Thesis Lead` (parallel with barrier convergence).
- Checkpoint granularity = team stage (NOT role).
- Output pair: human-readable markdown + structured decision object (decision object is the system-primary consumer).
- `orderDrafts` is broker-neutral; broker adapters sit downstream of Human Approval.
- Chat auto-upgrade thresholds: `predictedToolCalls ≥ 6` OR `predictedToolRounds ≥ 3` OR `predictedWallClockSec ≥ 20`.
- Manual intervention operations v1: `pause`, `resume`, `approve-execution`.
- Retention: long-term, manual archive only.

## Reference Points in the Repository

| Concern | Anchor |
|---------|--------|
| Existing BullMQ queue pattern | `apps/api/src/queue/vectorize.{producer,consumer}.ts` |
| Existing event log | `apps/api/src/events/agent-event.service.ts` + `packages/db/src/schema/agent-events.ts` |
| Existing trading contracts | `apps/api/src/trading/interfaces/trading-engine.ts`, `packages/shared/src/schemas/trading.ts` |
| Existing Drizzle migration style | `packages/db/migrations/V10__add_watchlist_tables.sql` |
| Existing Drizzle schema style | `packages/db/src/schema/watchlist-items.ts` + `relations.ts` |
| Existing schedule/heartbeat | `apps/api/src/autonomy/{schedule,heartbeat}.service.ts` |
| Existing chat entry | `apps/api/src/chat/chat.service.ts`, `chat-compaction.service.ts` |
| Existing workspace shell | `apps/web/src/views/AnalysisPage.tsx` |
| TradingAgents reference | `/Users/hongxichen/Downloads/TradingAgents/tradingagents/graph/trading_graph.py`, `agents/utils/agent_states.py` |

---

Start execution with **Plan A**.
