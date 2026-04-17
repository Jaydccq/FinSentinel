# Multi-Agent Runtime V1 — Rollout Runbook

## Pre-flight Checklist

- [ ] Plans A + B + C + D all landed on `main`.
- [ ] Migration `V11__add_analysis_runtime_tables.sql` applied against staging + prod.
- [ ] Four tables visible in prod Postgres: `analysis_runs`, `analysis_stages`, `analysis_artifacts`, `analysis_approvals`.
- [ ] Redis has capacity for the new `finsentinel-analysis-run` BullMQ queue.
- [ ] OpenRouter rate limits verified for up to 4 concurrent role calls per run (per team) and up to ~12 role calls per full run.
- [ ] Feature flags (all default `false`):
      - `ANALYSIS_RUNS_ENABLED`
      - `CHAT_AUTO_UPGRADE_ENABLED`
      - `APPROVAL_AUTO_DISPATCH_ENABLED`

## Phase 1 — Staging Smoke Test

1. Set `ANALYSIS_RUNS_ENABLED=true`; keep the other two flags `false`.
2. `POST /analysis/runs` with `{ "prompt": "Complete analysis of AAPL", "sourceMode": "WORKSPACE" }`.
3. Confirm in logs: `RUN_QUEUED → RUN_STARTED → INTELLIGENCE_TEAM_STARTED → ... → EXECUTION_APPROVAL_REQUIRED`.
4. Open `/analysis?runId=<id>` and confirm all 5 stages show in the Live Progress panel.
5. Click `Approve Execution` — confirm an `EXECUTION_PAYLOAD` artifact row appears and the run flips to `COMPLETED`.

## Phase 2 — Staging Chat Auto-Upgrade

1. Add `CHAT_AUTO_UPGRADE_ENABLED=true`.
2. Submit a chat message `"Give me a complete analysis of AAPL"`.
3. Confirm response headers contain `X-Analysis-Run-Id` and `X-Analysis-Upgrade-Reason`.
4. Confirm the assistant reply shows the "Open Run" banner.
5. Confirm the chat-spawned run reaches `WAITING_APPROVAL` identically to a workspace-spawned run.

## Phase 3 — Staging Autonomy

1. Create a cron schedule with `cron_expression: "*/2 * * * *"` and `task_type: "PORTFOLIO_REVIEW"`.
2. Wait up to 2 minutes and confirm `lastRunAt` updates and a new `SCHEDULE`-sourced run appears.
3. Enable heartbeat at a 60-second interval; confirm `lastBeatAt` updates every tick and `HEARTBEAT`-sourced runs appear.

## Phase 4 — Production Rollout

1. Merge this runbook.
2. Production env: flip `ANALYSIS_RUNS_ENABLED=true`.
3. Monitor for 24 hours:
   - BullMQ `finsentinel-analysis-run` queue depth (warn > 50).
   - `RUN_FAILED` event rate (warn > 2/hour).
   - OpenRouter spend vs prior baseline.
4. If stable, flip `CHAT_AUTO_UPGRADE_ENABLED=true`.
5. Keep `APPROVAL_AUTO_DISPATCH_ENABLED=false` until the broker side is independently re-verified.

## Rollback

- Flip `ANALYSIS_RUNS_ENABLED=false`. Legacy `/analysis/stream/:ticker` reactivates.
- In-flight runs stay persisted; a future re-enable can resume them via `POST /analysis/runs/:id/resume`.
- Optional cleanup (only if explicitly approved):
  ```sql
  UPDATE analysis_runs
  SET status = 'CANCELED'
  WHERE status IN ('QUEUED', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL');
  ```

## Known v1 Limits

- No custom DAG builder; topology is hard-coded as `Intelligence → Thesis → Risk → Execution Prep → Human Approval`.
- Role-level checkpoints are not persisted — only team-stage.
- `orderDrafts` quantity modes `PERCENT_NAV` and `CONTRACTS` are rejected by the mapper. v2 will resolve NAV / product-multiplier.
- Chat auto-upgrade thresholds are rule-based (`6 tool calls / 3 rounds / 20 s` or explicit intent phrasing). No learned policy.
- `ContextFabricService` session-layer is stubbed (empty summary) because wiring `ChatCompactionService` here would create a circular module dep. Session summaries still flow via `ChatCompactionService.augmentPrompt` at the chat entry.

## v1.1 hardening status (2026-04-17)

Tasks completed:
- V12 migration widens `agent_events_event_type_check` and adds
  `agent_events_aggregate_type_check` (covers all v1 runtime event/aggregate types).
- V13 migration adds `schema_versions`. New `pnpm db:migrate` runner replaces the
  stale drizzle-kit workflow.
- `RoleExecutorService.parseStructured` now tolerates un-fenced JSON output via
  a 3-strategy extractor (```json fence → bare ``` fence → balanced `{...}` scan).
- `AnalysisCheckpointService.startStage` is idempotent via `ON CONFLICT DO UPDATE`.
- Integration test `runtime-happy-path.integration.spec.ts` runs the pipeline
  service-level end-to-end: QUEUED → WAITING_APPROVAL → COMPLETED/CANCELED paths,
  plus idempotent-preflight coverage.
- `CLAUDE.md` now documents dual-Postgres trap + insert-all-columns convention.
- docker-compose Postgres moved to host port 5433 to avoid 5432 collision.

Deferred to v1.2 (tracked in `docs/exec-plans/tech-debt-tracker.md`):
- Staging deploy (needs creds not on this session).
- Retroactive split of the 117-commit v1 push into per-plan PRs.
- Driver evaluation: postgres.js vs node-postgres.
