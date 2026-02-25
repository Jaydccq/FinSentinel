-- ============================================================================
-- V4: Scope agent event idempotency to user to avoid cross-user dedupe
-- ============================================================================

DROP INDEX IF EXISTS idx_agent_events_idempotency_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_user_idempotency_key
    ON agent_events(user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
