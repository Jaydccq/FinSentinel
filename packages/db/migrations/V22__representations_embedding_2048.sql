-- V22: enlarge document_chunk_representations.embedding from vector(1536)
-- to vector(2048) to accommodate NVIDIA Build embedding models
-- (nvidia/llama-nemotron-embed-1b-v2 = 2048 dims).
--
-- pgvector HNSW caps at 2000 dimensions (hnswbuild.c), so we must drop
-- the existing HNSW index before enlarging. For < 2000-dim deployments
-- (e.g. OpenAI text-embedding-3-small at 1536 dims) operators can
-- reapply HNSW out-of-band with a CREATE INDEX after narrowing the
-- column back. The representation-lane dense search still works
-- without HNSW — it falls back to a seq-scan over the (typically
-- small) representation rows, which is fine for dev and acceptable
-- for production-scale corpora up to ~100k rows.
--
-- Multi-provider dimension support is a separate workstream —
-- filed in tech-debt-tracker as "multi-provider embedding dim".

DROP INDEX IF EXISTS idx_dcr_embedding_hnsw;

ALTER TABLE document_chunk_representations
  ALTER COLUMN embedding TYPE vector(2048);

-- ROLLBACK:
-- ALTER TABLE document_chunk_representations
--   ALTER COLUMN embedding TYPE vector(1536);
-- CREATE INDEX IF NOT EXISTS idx_dcr_embedding_hnsw
--   ON document_chunk_representations USING hnsw (embedding vector_cosine_ops)
--   WHERE representation_type IN ('contextual_text', 'sample_question');
