-- ============================================================================
-- V13: Add schema_versions tracking table for the migration runner
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_versions (
    version     INTEGER PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum    VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schema_versions_applied_at
    ON schema_versions (applied_at DESC);
