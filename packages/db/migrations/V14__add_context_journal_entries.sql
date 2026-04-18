-- ============================================================================
-- V14: Add context journal entries
-- Keeps the canonical production migration in packages/db/migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS context_journal_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    session_id      UUID,
    run_id          UUID REFERENCES analysis_runs(id) ON DELETE CASCADE,
    stage_key       VARCHAR(32),
    role_key        VARCHAR(64),
    entry_type      VARCHAR(40) NOT NULL,
    source_type     VARCHAR(32) NOT NULL,
    source_ref      VARCHAR(255),
    payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_context_journal_run_created
    ON context_journal_entries(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_context_journal_session_created
    ON context_journal_entries(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_context_journal_stage_created
    ON context_journal_entries(stage_key, created_at DESC);
