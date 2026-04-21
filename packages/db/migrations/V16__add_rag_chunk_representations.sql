-- V16: Add document_chunk_representations side table + structural columns on document_chunks
--
-- EDITED 2026-04-21 to align with the canonical embedding provider
-- (NVIDIA `nvidia/llama-nemotron-embed-1b-v2`, 2048-dim). The column
-- is declared `vector(2048)` directly; no HNSW index is created here
-- because pgvector's HNSW caps at 2000 dims. For smaller-dim
-- deployments (e.g. 1536) operators can ALTER the column back and
-- CREATE INDEX ... USING hnsw out-of-band — the downstream retrieval
-- code is indifferent.
--
-- Historical note: an earlier revision of this file declared `vector`
-- (no dim) which broke fresh-DB migrations on the HNSW create step,
-- then briefly `vector(1536)` assuming text-embedding-3-small. V22
-- exists as a bridge migration for DBs that applied those earlier
-- revisions — it ALTERs to 2048 + drops HNSW. Fresh DBs that run
-- this file directly skip V22's work via IF NOT EXISTS / ALTER-to-same
-- idempotency, but keep V22 in the sequence for safety.

CREATE TABLE IF NOT EXISTS document_chunk_representations (
  id uuid PRIMARY KEY,
  chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  representation_type varchar(32) NOT NULL,
  content text NOT NULL,
  embedding vector(2048),
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

-- No HNSW index: pgvector caps HNSW at 2000 dims; our canonical
-- embedding is 2048. Dense-lane retrieval uses a seq-scan over the
-- representation rows (fine at the corpus scales we target in this
-- plan; revisit with IVFFlat if representation row count grows past
-- a few hundred thousand).

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
-- DROP INDEX IF EXISTS idx_dcr_chunk_type;
-- DROP TABLE IF EXISTS document_chunk_representations;
