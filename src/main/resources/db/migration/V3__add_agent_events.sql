-- ============================================================================
-- V3: Add typed append-only agent events table for autonomy workflows
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seq_no              BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    user_id             UUID         NOT NULL REFERENCES users(id),
    aggregate_type      VARCHAR(50)  NOT NULL,
    aggregate_id        UUID,
    event_type          VARCHAR(100) NOT NULL,
    payload_json        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key     VARCHAR(128),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_user_seq
    ON agent_events(user_id, seq_no DESC);

CREATE INDEX IF NOT EXISTS idx_agent_events_user_created
    ON agent_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_events_aggregate
    ON agent_events(aggregate_type, aggregate_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_idempotency_key
    ON agent_events(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
