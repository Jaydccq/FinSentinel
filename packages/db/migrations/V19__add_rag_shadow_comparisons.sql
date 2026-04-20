-- V19: add rag_shadow_comparisons for R7 shadow/canary rollout.
-- Records per-query comparisons between the single-stage and multi-stage
-- retrieval pipelines. Supports the offline analyser's precision/recall
-- and latency reporting queries.

CREATE TABLE IF NOT EXISTS rag_shadow_comparisons (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash                    text NOT NULL,
  query_class                   text NOT NULL,
  single_stage_chunk_ids        text[] NOT NULL DEFAULT '{}',
  multi_stage_chunk_ids         text[] NOT NULL DEFAULT '{}',
  single_stage_latency_ms       integer,
  multi_stage_latency_ms        integer,
  shadow_timed_out              boolean NOT NULL DEFAULT false,
  shadow_dropped_backpressure   boolean NOT NULL DEFAULT false,
  multi_stage_error             text,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_shadow_comparisons_created_at
  ON rag_shadow_comparisons (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_shadow_comparisons_query_class
  ON rag_shadow_comparisons (query_class, created_at DESC);

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_rag_shadow_comparisons_query_class;
-- DROP INDEX IF EXISTS idx_rag_shadow_comparisons_created_at;
-- DROP TABLE IF EXISTS rag_shadow_comparisons;
