import { registerAs } from '@nestjs/config';

export const ragConfig = registerAs('rag', () => ({
  chunking: {
    chunkSize: Number(process.env['RAG_CHUNK_SIZE']) || 500,
    chunkOverlap: Number(process.env['RAG_CHUNK_OVERLAP']) || 50,
    minChunkSizeChars:
      Number(process.env['RAG_MIN_CHUNK_SIZE_CHARS']) || 200,
    maxNumChunks: Number(process.env['RAG_MAX_NUM_CHUNKS']) || 10000,
  },
  retrieval: {
    defaultTopK: Number(process.env['RAG_DEFAULT_TOP_K']) || 5,
    similarityThreshold:
      Number(process.env['RAG_SIMILARITY_THRESHOLD']) || 0.65,
    maxTopK: Number(process.env['RAG_MAX_TOP_K']) || 20,
    queryRewriteEnabled:
      process.env['RAG_QUERY_REWRITE_ENABLED'] !== 'false',
  },
  backfill: {
    enabled: process.env['RAG_REINDEX_ENABLED'] !== 'false',
    intervalMs: Number(process.env['RAG_REINDEX_INTERVAL_MS']) || 900000,
    startupDelayMs: Number(process.env['RAG_REINDEX_STARTUP_DELAY_MS']) || 30000,
    documentBatchSize:
      Number(process.env['RAG_REINDEX_DOCUMENT_BATCH_SIZE']) || 25,
    newsBatchSize:
      Number(process.env['RAG_REINDEX_NEWS_BATCH_SIZE']) || 25,
    force: process.env['RAG_REINDEX_FORCE'] === 'true',
  },
}));
