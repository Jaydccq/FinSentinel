-- V26: Widen agent_events.event_type CHECK to include
-- 'LEDGER_UNKNOWN_ACKNOWLEDGED'.
--
-- Authority: packages/shared/src/enums/agent-event-type.ts. Adding an enum
-- value there requires a numbered migration that mirrors the SQL CHECK to
-- the TS enum exactly (per CLAUDE.md). The full IN-list below replicates
-- V12 (the latest prior migration that touched this CHECK) and appends
-- LEDGER_UNKNOWN_ACKNOWLEDGED.
--
-- Used by OrderLedgerService.acknowledge() under aggregate TRADE_WALLET so
-- that operator-action audit rows sit next to the other trading events.

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
            'LEDGER_UNKNOWN_ACKNOWLEDGED'
        )
    );
