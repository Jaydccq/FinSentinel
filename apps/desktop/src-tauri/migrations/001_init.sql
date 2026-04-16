-- Private documents — never synced, never uploaded.
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  page_count INTEGER,
  title TEXT,
  created_at INTEGER NOT NULL,
  indexed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);
CREATE INDEX IF NOT EXISTS idx_documents_indexed_at ON documents(indexed_at);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

-- Vector table via sqlite-vec. Dimension MUST match fastembed model output.
-- Default model (BAAI/bge-small-en-v1.5) → 384 dims.
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding FLOAT[384]
);
