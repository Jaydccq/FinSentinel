-- ============================================================================
-- V6: Expand agent_event_type and agent_schedule_task_type constraints
--     for OKX crypto events and CRYPTO_HEALTH_CHECK schedule task
-- ============================================================================

-- Drop any existing CHECK constraint on event_type (safe no-op if absent)
ALTER TABLE agent_events DROP CONSTRAINT IF EXISTS agent_events_event_type_check;

-- Add CHECK constraint covering all 21 event types (original 17 + 4 OKX)
ALTER TABLE agent_events ADD CONSTRAINT agent_events_event_type_check CHECK (
    event_type IN (
        'CHAT_SESSION_STARTED', 'CHAT_MESSAGE_PERSISTED', 'CHAT_CONTEXT_COMPACTED', 'CHAT_STREAM_ERROR',
        'TRADING_MODE_SWITCHED', 'TRADE_OPERATION_STAGED', 'TRADE_COMMIT_CREATED', 'TRADE_COMMIT_EXECUTED',
        'BRAIN_STRATEGY_UPDATED', 'BRAIN_EMOTION_UPDATED',
        'SCHEDULE_CREATED', 'SCHEDULE_UPDATED', 'SCHEDULE_DELETED', 'SCHEDULE_EXECUTED', 'SCHEDULE_FAILED',
        'HEARTBEAT_TICK', 'HEARTBEAT_ALERT',
        'OKX_POSITION_OPENED', 'OKX_POSITION_CLOSED', 'OKX_RISK_ALERT', 'OKX_HEALTH_CHECK_RUN'
    )
);

-- Drop any existing CHECK constraint on task_type (safe no-op if absent)
ALTER TABLE agent_schedules DROP CONSTRAINT IF EXISTS agent_schedules_task_type_check;

-- Add CHECK constraint covering all 5 schedule task types (original 4 + CRYPTO_HEALTH_CHECK)
ALTER TABLE agent_schedules ADD CONSTRAINT agent_schedules_task_type_check CHECK (
    task_type IN ('PORTFOLIO_REVIEW', 'MARKET_PULSE', 'BRAIN_REVIEW', 'HEARTBEAT_WAKEUP', 'CRYPTO_HEALTH_CHECK')
);
