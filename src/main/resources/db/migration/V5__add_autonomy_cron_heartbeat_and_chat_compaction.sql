-- ============================================================================
-- V5: Add autonomy cron schedules, heartbeat configs, and chat compaction memory
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_schedules (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID         NOT NULL REFERENCES users(id),
    name                VARCHAR(120) NOT NULL,
    cron_expression     VARCHAR(120) NOT NULL,
    task_type           VARCHAR(50)  NOT NULL,
    task_payload        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    enabled             BOOLEAN      NOT NULL DEFAULT TRUE,
    last_run_at         TIMESTAMP WITH TIME ZONE,
    next_run_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_schedules_user_created
    ON agent_schedules(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_schedules_enabled_next_run
    ON agent_schedules(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS agent_heartbeat_configs (
    user_id             UUID PRIMARY KEY REFERENCES users(id),
    enabled             BOOLEAN      NOT NULL DEFAULT TRUE,
    interval_seconds    INTEGER      NOT NULL DEFAULT 600,
    drawdown_alert_pct  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    last_beat_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_enabled_last_beat
    ON agent_heartbeat_configs(enabled, last_beat_at);

CREATE TABLE IF NOT EXISTS chat_session_memories (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    session_id              UUID NOT NULL,
    summary_text            TEXT NOT NULL DEFAULT '',
    compacted_message_count INTEGER NOT NULL DEFAULT 0,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_chat_session_memory_user_session UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_session_memories_user_session
    ON chat_session_memories(user_id, session_id);
