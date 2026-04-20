-- V18: add documents.meta JSONB column for CLI-stamped metadata.
-- Used by rag:reindex:by-doctype to record chunker_version so subsequent
-- runs can detect already-reindexed documents and skip them (idempotency).

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ROLLBACK:
-- ALTER TABLE documents DROP COLUMN IF EXISTS meta;
