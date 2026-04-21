-- V16: Add document_chunk_representations side table + structural columns on document_chunks
--
-- EDIT 2026-04-21 (P4 / tech-debt fix for fresh-DB migrations):
-- Original `embedding vector` (no dimension) broke HNSW build on fresh
-- DBs ("column does not have dimensions" — pgvector hnswbuild.c:679).
-- Changed to `vector(1536)` so fresh DBs migrate cleanly. Already-
-- migrated DBs are unaffected — the migration runner skips by version
-- number, not checksum (see packages/db/src/apply-migrations.ts). This
-- is a documented exception to "migrations are immutable once shipped."
-- Multi-provider embedding-dim support (e.g. NVIDIA nv-embed-v1's
-- alternate dimension) will require per-provider tables or optional-
-- HNSW rework — filed separately under RAG tech debt.

CREATE TABLE IF NOT EXISTS document_chunk_representations (
  id uuid PRIMARY KEY,
  chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  representation_type varchar(32) NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  search_vector tsvector,
  weight real NOT NULL DEFAULT 1.0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcr_representation_type_check CHECK (
    representation_type IN ('contextual_text', 'sample_question', 'summary', 'keyword_entity')
  )
);

CREATE INDEX IF NOT EXISTS idx_dcr_chunk_type
  ON document_chunk_representations (chunk_id, representation_type);

CREATE INDEX IF NOT EXISTS idx_dcr_embedding_hnsw
  ON document_chunk_representations USING hnsw (embedding vector_cosine_ops)
  WHERE representation_type IN ('contextual_text', 'sample_question');

CREATE INDEX IF NOT EXISTS idx_dcr_search_vector
  ON document_chunk_representations USING gin (search_vector)
  WHERE search_vector IS NOT NULL;

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES document_chunks(id) ON DELETE SET NULL;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS section_path text;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS enrichment_status varchar(16) NOT NULL DEFAULT 'pending'
  CONSTRAINT document_chunks_enrichment_status_check CHECK (enrichment_status IN ('pending','in_progress','succeeded','failed'));

-- ROLLBACK:
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS enrichment_status;
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS section_path;
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS parent_id;
-- DROP INDEX IF EXISTS idx_dcr_search_vector;
-- DROP INDEX IF EXISTS idx_dcr_embedding_hnsw;
-- DROP INDEX IF EXISTS idx_dcr_chunk_type;
-- DROP TABLE IF EXISTS document_chunk_representations;
