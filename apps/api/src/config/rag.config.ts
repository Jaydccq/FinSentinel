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
    hydeEnabled: process.env['RAG_HYDE_ENABLED'] === 'true',
    queryDecomposeEnabled: process.env['RAG_QUERY_DECOMPOSE_ENABLED'] === 'true',
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
  multiStage: {
    fusionRrfK: Number(process.env['RAG_FUSION_RRF_K']) || 60,
    topKPerLane: Number(process.env['RAG_TOP_K_PER_LANE']) || 20,
    topKAfterFusion: Number(process.env['RAG_TOP_K_AFTER_FUSION']) || 50,
    topKAfterRerank: Number(process.env['RAG_TOP_K_AFTER_RERANK']) || 10,
    contextMaxTokens: Number(process.env['RAG_CONTEXT_MAX_TOKENS']) || 4096,
    contextMaxChunksPerSource:
      Number(process.env['RAG_CONTEXT_MAX_CHUNKS_PER_SOURCE']) || 3,
  },
  graph: {
    enabled: process.env['RAG_GRAPH_ENABLED'] !== 'false',
    maxHops: Number(process.env['RAG_GRAPH_MAX_HOPS']) || 2,
    hopDecay: Number(process.env['RAG_GRAPH_HOP_DECAY']) || 0.6,
    topologyWeight: Number(process.env['RAG_GRAPH_TOPOLOGY_WEIGHT']) || 0.4,
    relevanceWeight:
      Number(process.env['RAG_GRAPH_RELEVANCE_WEIGHT']) || 0.6,
    minEntityConfidence:
      Number(process.env['RAG_GRAPH_MIN_ENTITY_CONFIDENCE']) || 0.7,
  },
  rerank: {
    maxTokens: Number(process.env['RAG_RERANK_MAX_TOKENS']) || 480,
  },
  contextExpansion: {
    enabled: process.env['RAG_CONTEXT_EXPANSION_ENABLED'] === 'true',
    topN: Number(process.env['RAG_CONTEXT_EXPANSION_TOP_N']) || 10,
  },
  queryLog: {
    sampleRate: Number(process.env['RAG_QUERY_LOG_SAMPLE_RATE'] ?? '1.0'),
    retentionDays: Number(process.env['RAG_QUERY_LOG_RETENTION_DAYS'] ?? '30'),
    piiEnabled: process.env['RAG_QUERY_LOG_PII_ENABLED'] === 'true',
    // Retention is gated off by default — operator must opt in.
    retentionEnabled: process.env['RAG_QUERY_LOG_RETENTION_ENABLED'] === 'true',
  },
}));
