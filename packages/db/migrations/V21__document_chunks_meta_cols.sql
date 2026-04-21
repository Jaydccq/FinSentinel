-- V21: add meta_title / meta_source / meta_entities / search_vector columns
-- on document_chunks.
--
-- Drizzle schema (packages/db/src/schema/document-chunks.ts) has referenced
-- these columns + the idx_document_chunks_fts index since at least R4, but
-- no migration SQL creates them. Existing dev DBs received them via manual
-- ALTER statements at some point (source unknown). Fresh DBs migrating from
-- V1 forward fail at first INSERT because the INSERT statement Drizzle
-- generates references columns that do not yet exist.
--
-- This migration closes that schema-migration drift so fresh
-- (e.g. finsentinel_test) DBs and CI environments migrate cleanly.
--
-- All ALTERs use IF NOT EXISTS so re-applying to already-drifted dev DBs
-- is a no-op. The FTS index is CREATE INDEX IF NOT EXISTS for the same
-- reason.

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS meta_title text,
  ADD COLUMN IF NOT EXISTS meta_source text,
  ADD COLUMN IF NOT EXISTS meta_entities text,
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_document_chunks_fts
  ON document_chunks
  USING gin (search_vector);

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_document_chunks_fts;
-- ALTER TABLE document_chunks
--   DROP COLUMN IF EXISTS search_vector,
--   DROP COLUMN IF EXISTS meta_entities,
--   DROP COLUMN IF EXISTS meta_source,
--   DROP COLUMN IF EXISTS meta_title;
