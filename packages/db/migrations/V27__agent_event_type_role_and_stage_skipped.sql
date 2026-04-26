-- V27: Widen agent_events.event_type CHECK to align with the TS enum.
--
-- Closes the SQL-vs-TS drift recorded in tech-debt-tracker.md
-- ("agent_events SQL CHECK constraint vs TS AgentEventType enum drift").
-- The TS enum at packages/shared/src/enums/agent-event-type.ts has carried
-- four values that V12/V26's CHECK never included:
--
--   STAGE_SKIPPED       — actively emitted at
--                         apps/api/src/analysis/analysis-checkpoint.service.ts:270.
--                         Without this value in the CHECK, every SKIPPED-stage
--                         INSERT fails at the DB layer. Latent bug closed.
--   ROLE_STARTED        — declared for Phase 2/3 consumers per
--   ROLE_COMPLETED        [PHASE1-TD-04] (2026-04-19). Not emitted today, but
--   ROLE_FAILED           tracker explicitly notes "phase 2/3 consumers". Adding
--                         them preemptively avoids the future surprise where
--                         enabling those consumers would otherwise hit the
--                         same CHECK violation STAGE_SKIPPED hits today.
--
-- The full IN-list below replicates V26 verbatim and appends the four new
-- values. CLAUDE.md rule: SQL CHECK must mirror the TS enum exactly.

ALTER TABLE agent_events
    DROP CONSTRAINT IF EXISTS agent_events_event_type_check;

ALTER TABLE agent_events
    ADD CONSTRAINT agent_events_event_type_check CHECK (
        event_type IN (
            -- Chat (V3/V5)
            'CHAT_SESSION_STARTED', 'CHAT_MESSAGE_PERSISTED',
            'CHAT_CONTEXT_COMPACTED', 'CHAT_STREAM_ERROR',
            -- Trading (V3)
            'TRADING_MODE_SWITCHED', 'TRADE_OPERATION_STAGED',
            'TRADE_COMMIT_CREATED', 'TRADE_COMMIT_EXECUTED',
            -- Brain (V3)
            'BRAIN_STRATEGY_UPDATED', 'BRAIN_EMOTION_UPDATED',
            -- Schedule (V5)
            'SCHEDULE_CREATED', 'SCHEDULE_UPDATED', 'SCHEDULE_DELETED',
            'SCHEDULE_EXECUTED', 'SCHEDULE_FAILED',
            -- Heartbeat (V5)
            'HEARTBEAT_TICK', 'HEARTBEAT_ALERT',
            -- OKX (V6)
            'OKX_POSITION_OPENED', 'OKX_POSITION_CLOSED',
            'OKX_RISK_ALERT', 'OKX_HEALTH_CHECK_RUN',
            -- Analysis run lifecycle (v1 runtime)
            'RUN_QUEUED', 'RUN_STARTED', 'RUN_PAUSED', 'RUN_RESUMED',
            'RUN_FAILED', 'RUN_COMPLETED', 'RUN_CANCELED',
            -- Stage/team events (v1 runtime)
            'INTELLIGENCE_TEAM_STARTED', 'INTELLIGENCE_TEAM_COMPLETED',
            'THESIS_TEAM_STARTED', 'THESIS_TEAM_COMPLETED',
            'RISK_TEAM_STARTED', 'RISK_TEAM_COMPLETED',
            'EXECUTION_PREP_TEAM_STARTED', 'EXECUTION_PREP_TEAM_COMPLETED',
            -- Role events inside Thesis team (v1 runtime)
            'POSITIVE_CASE_STARTED', 'POSITIVE_CASE_COMPLETED',
            'NEGATIVE_CASE_STARTED', 'NEGATIVE_CASE_COMPLETED',
            'THESIS_LEAD_STARTED', 'THESIS_LEAD_COMPLETED',
            -- Approval gate (v1 runtime)
            'EXECUTION_APPROVAL_REQUIRED', 'EXECUTION_APPROVED',
            'EXECUTION_REJECTED',
            -- Misc (v1 runtime)
            'TOOL_CALLED', 'STAGE_CHECKPOINT_COMMITTED', 'CHAT_AUTO_UPGRADED',
            -- Order ledger operator actions (V26 — M4 prereq (2))
            'LEDGER_UNKNOWN_ACKNOWLEDGED',
            -- Generic role lifecycle + stage skip (V27 — TS enum sync)
            'ROLE_STARTED', 'ROLE_COMPLETED', 'ROLE_FAILED', 'STAGE_SKIPPED'
        )
    );
