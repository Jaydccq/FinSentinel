-- V22: bridge migration for DBs that applied an earlier revision of V16
-- (which declared `embedding vector(1536)` and created an HNSW index
-- on it). Since 2026-04-21 the canonical embedding provider is
-- `nvidia/llama-nemotron-embed-1b-v2` at 2048 dims, so we:
--   (a) drop the HNSW index — pgvector caps HNSW at 2000 dims
--   (b) widen the column to vector(2048) so 2048-dim inserts succeed
--
-- On fresh DBs that applied the current V16 directly, both statements
-- are idempotent:
--   * DROP INDEX IF EXISTS is a no-op when the index was never created
--   * ALTER COLUMN TYPE to the same type Postgres treats as a no-op
--
-- Multi-provider deployments with smaller embedding dims (e.g. 1536
-- for OpenAI text-embedding-3-small) can narrow back with
--   ALTER COLUMN embedding TYPE vector(1536)
--   CREATE INDEX idx_dcr_embedding_hnsw ...
-- out-of-band. Downstream retrieval code is dim-agnostic.

DROP INDEX IF EXISTS idx_dcr_embedding_hnsw;

ALTER TABLE document_chunk_representations
  ALTER COLUMN embedding TYPE vector(2048);

-- ROLLBACK (only meaningful if downgrading to a 1536-dim provider):
-- ALTER TABLE document_chunk_representations
--   ALTER COLUMN embedding TYPE vector(1536);
-- CREATE INDEX IF NOT EXISTS idx_dcr_embedding_hnsw
--   ON document_chunk_representations USING hnsw (embedding vector_cosine_ops)
--   WHERE representation_type IN ('contextual_text', 'sample_question');
