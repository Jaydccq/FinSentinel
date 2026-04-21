-- V20: GIN index on document_chunks.metadata for JSONB operator support.
--
-- Closes [RAG-TD-R4-05] from docs/exec-plans/tech-debt-tracker.md.
--
-- SparseSearchService and (after P3.2 of
-- docs/exec-plans/2026-04-21-rag-quality-next-steps.md) the dense lane
-- both apply `(metadata->'tickers') ?| $::text[]` and
-- `metadata->>'issuerName' = ANY($::text[])` on the hot path. Without an
-- index, every filtered retrieval call sequentially scans
-- document_chunks. This migration adds a GIN index so those queries use
-- a Bitmap Index Scan instead.
--
-- Uses the default `jsonb_ops` operator class (NOT `jsonb_path_ops`)
-- because `?|` requires the full operator class — `jsonb_path_ops`
-- would only index `@>` / `@?` queries.
--
-- CONCURRENTLY would avoid table locks on production but cannot run
-- inside the plain-SQL migration transaction wrapper. Dev DBs are
-- small; production ops can apply this out-of-band with
-- `CREATE INDEX CONCURRENTLY ... IF NOT EXISTS` if needed.

CREATE INDEX IF NOT EXISTS document_chunks_metadata_gin_idx
  ON document_chunks
  USING gin (metadata);

-- ROLLBACK:
-- DROP INDEX IF EXISTS document_chunks_metadata_gin_idx;
