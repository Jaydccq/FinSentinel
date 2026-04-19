-- V17: add rag_query_logs for multi-stage retrieval trace logging.
-- Partitioned by created_at range (monthly) so retention can drop whole partitions cheaply.

-- pgcrypto is required for gen_random_uuid(). Most setups already have it via the initial
-- schema; the IF NOT EXISTS guard makes this safe to re-run either way.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rag_query_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid,
    query_hash varchar(64) NOT NULL,          -- sha256 hex of query text
    query_preview text,                        -- only populated when PII enabled
    query_class varchar(32),
    variants jsonb NOT NULL DEFAULT '[]',      -- [{kind, query_hash}]
    filters jsonb NOT NULL DEFAULT '{}',
    lanes varchar(32)[] NOT NULL DEFAULT '{}',
    result_chunk_ids uuid[] NOT NULL DEFAULT '{}',
    lane_counts jsonb NOT NULL DEFAULT '{}',   -- per-lane candidate counts
    timings_ms jsonb NOT NULL DEFAULT '{}',    -- per-stage ms
    fallback_flags varchar(64)[] NOT NULL DEFAULT '{}',
    rerank_reason varchar(32),                 -- null | rerank_malformed | rerank_unavailable
    total_ms integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Default partition for safety (catches any insert outside explicit partitions)
CREATE TABLE IF NOT EXISTS rag_query_logs_default PARTITION OF rag_query_logs DEFAULT;

-- Seed the current month's partition so steady-state inserts never land in the default.
-- The retention job creates future monthly partitions preemptively at rollover time.
-- DO block makes the file re-runnable without error.
DO $$
DECLARE
  _start date := date_trunc('month', now())::date;
  _end   date := (date_trunc('month', now()) + interval '1 month')::date;
  _name  text := 'rag_query_logs_' || to_char(_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF rag_query_logs FOR VALUES FROM (%L) TO (%L)',
    _name, _start, _end
  );
END$$;

CREATE INDEX IF NOT EXISTS idx_rag_query_logs_created_at ON rag_query_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_query_logs_user_created ON rag_query_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_query_logs_fallback ON rag_query_logs USING gin (fallback_flags) WHERE array_length(fallback_flags, 1) > 0;

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_rag_query_logs_fallback;
-- DROP INDEX IF EXISTS idx_rag_query_logs_user_created;
-- DROP INDEX IF EXISTS idx_rag_query_logs_created_at;
-- DROP TABLE IF EXISTS rag_query_logs_default;
-- (per-month partitions: find via information_schema.tables WHERE table_name ~ '^rag_query_logs_\d{4}_\d{2}$')
-- DROP TABLE IF EXISTS rag_query_logs CASCADE;
