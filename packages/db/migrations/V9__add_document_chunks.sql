CREATE TABLE IF NOT EXISTS document_chunks (
    id uuid PRIMARY KEY,
    source_type varchar(20) NOT NULL,
    source_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding vector NOT NULL,
    metadata jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_document_chunks_source_chunk
ON document_chunks (source_type, source_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_document_chunks_source
ON document_chunks (source_type, source_id);
