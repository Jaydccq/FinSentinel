# OpenAlice Autonomy Gap and Step-by-Step Plan

## 1) What is still not implemented

### A. Cron scheduling system (AI-manageable)
Status: **Not implemented**

Current code has static `@Scheduled` jobs for internal pipelines, but no agent/user-facing schedule registry, no CRUD for tasks, and no dynamic cron management.

### B. Heartbeat wake-up loop
Status: **Not implemented**

There is no autonomous periodic "agent tick" that checks watchlists/positions and triggers decisions without user chat input.

### C. Generic typed append-only EventLog
Status: **Not implemented (partial domain-specific substitutes exist)**

You have JSONB commit histories (`agent_brains.commit_history`, `trade_wallets.commit_history`, `user_investment_profiles.state_history`), but these are per-aggregate bounded arrays and not a global append-only event stream for scheduling/recovery.

### D. Context window compaction
Status: **Not implemented**

Chat uses direct history retrieval (`Top100`/`Top50`) and does not persist compacted checkpoints (micro-summary + long-summary) for long sessions.

## 2) Priority (autonomy impact)

1. **Cron scheduling system** (highest impact)
2. **Heartbeat wake-up**
3. **EventLog** (critical reliability foundation)
4. **Context compaction**

Note: for implementation safety/dependencies, build order should be:
1) EventLog foundation -> 2) Cron engine -> 3) Heartbeat -> 4) Context compaction.

## 3) Step-by-step implementation plan

## Phase 1: EventLog foundation
Goal: introduce durable, typed, append-only events.

1. Add `agent_events` table (id, user_id, aggregate_type, aggregate_id, event_type, payload_json, idempotency_key, created_at).
2. Add write API/service with strict append-only semantics (no update/delete).
3. Add query APIs for timeline and cursor-based replay.
4. Emit events from trade/brain/chat critical transitions.
5. Add retention + partition strategy if volume grows.

Acceptance:
- Events are immutable and replayable by cursor/time.
- Duplicate writes are rejected by `idempotency_key`.

## Phase 2: Cron scheduling system (AI-manageable)
Goal: agent can create/manage recurring tasks.

1. Add `agent_schedules` table (name, cron_expr, timezone, enabled, next_run_at, last_run_at, task_type, task_payload).
2. Add scheduler service to pull due jobs and enqueue execution.
3. Add CRUD API and a tool surface for the agent to manage schedules.
4. Add validation (cron syntax, min interval guardrails, ownership checks).
5. Record schedule lifecycle and executions in EventLog.

Acceptance:
- Agent can create/update/disable schedules through tools.
- Jobs execute at expected times and are traceable.

## Phase 3: Heartbeat autonomous loop
Goal: periodic autonomous checks and actions.

1. Implement `AgentHeartbeatService` driven by schedule entries (e.g., every 2h, pre-market, post-close).
2. Define deterministic heartbeat tasks (position risk scan, volatility spike scan, stale-orders check).
3. Add policy thresholds and safe action boundaries (notify-only vs auto-stage).
4. Emit heartbeat start/result/failure events.
5. Add failure backoff and dead-letter handling.

Acceptance:
- Agent produces periodic health/risk checks without user prompts.
- Failures are observable and recoverable.

## Phase 4: Context window compaction
Goal: maintain long-session quality and token efficiency.

1. Add per-session compaction checkpoints (`chat_session_compactions`).
2. Implement trigger policy (message count/token estimate/age thresholds).
3. Implement 2-level compaction:
   - micro-summary for recent turns
   - rolling long-summary for session memory
4. Change prompt assembly to use compacted checkpoints + recent raw turns.
5. Add quality checks to prevent losing key facts (tickers, risk constraints, user prefs).

Acceptance:
- Long sessions stay within token budget without major context loss.
- Retrieval latency and output consistency remain stable.

## 4) Recommended first sprint

Scope: **Phase 1 + minimal Phase 2 skeleton**

Deliver in sprint:
1. `agent_events` immutable model + repository + service
2. schedule schema + basic due-job poller
3. one system schedule (`PORTFOLIO_HEALTH_CHECK`) running in dry-run mode
4. end-to-end trace through EventLog

Why this first:
- Establishes reliability primitives first.
- Unlocks Cron and Heartbeat quickly with low rework.
