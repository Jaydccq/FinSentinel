import { registerAs } from '@nestjs/config';
import { z } from 'zod';

/**
 * Parses `RAG_SPARSE_WEIGHTS` (PG array literal like `"{0.1,0.2,0.4,1.0}"`)
 * into a typed 4-number tuple read as (D, C, B, A) — the reading order that
 * Postgres `ts_rank_cd(weights, vector, query)` expects. Higher index = higher
 * weight for the A-labelled lexemes (title + section_path + entities in the
 * representation-lane tsvectors; see `chunk-representation.tsvector.ts`).
 *
 * Invalid input (wrong length, non-numeric, out-of-range) fails fast at config
 * load rather than producing a silent mis-ranked query at retrieval time.
 * Values are bounded to the [0, 1] range consistent with Postgres docs and the
 * default `'{0.1, 0.2, 0.4, 1.0}'` vector.
 */
const SparseWeightsSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .describe('ts_rank_cd weights as [D, C, B, A] — higher = more weight for that slot');

function parseSparseWeights(raw: string | undefined): [number, number, number, number] {
  const fallback: [number, number, number, number] = [0.1, 0.2, 0.4, 1.0];
  if (!raw || !raw.trim()) return fallback;
  // Accept PG array literal `{…}` or a bare CSV; strip braces + whitespace.
  const stripped = raw.trim().replace(/^\{/, '').replace(/\}$/, '');
  const parts = stripped
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(
      `RAG_SPARSE_WEIGHTS must be a 4-element numeric PG array literal like "{0.1,0.2,0.4,1.0}"; got "${raw}"`,
    );
  }
  const tuple: [number, number, number, number] = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
  return SparseWeightsSchema.parse(tuple);
}

/**
 * Parse `RAG_METADATA_MIN_CANDIDATES_BY_CLASS` (JSON map of QueryClass to int).
 * Falls back to the 5-class default when unset. Rejects malformed JSON with a
 * clear error at config load so retrieval never sees a partially-parsed map.
 *
 * IMPORTANT: the `QueryClass` union in retrieval-planner.service.ts does NOT
 * include `colloquial` (see [RAG-TD-R4-02] in tech-debt-tracker.md). The env
 * key accepts extra keys but they are silently ignored at lookup time.
 */
function parseMinCandidatesByClass(
  raw: string | undefined,
): Record<string, number> {
  const fallback: Record<string, number> = {
    exact_lookup: 5,
    factoid: 15,
    relational: 20,
    analytical: 30,
    multi_part: 30,
  };
  if (!raw || !raw.trim()) return fallback;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `RAG_METADATA_MIN_CANDIDATES_BY_CLASS must be valid JSON; got "${raw}" (${msg})`,
    );
  }

  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(
        `RAG_METADATA_MIN_CANDIDATES_BY_CLASS has non-integer value for "${k}": ${JSON.stringify(v)}`,
      );
    }
    out[k] = n;
  }
  return out;
}

const VALID_PREFILTER_MODES = ['off', 'soft', 'hard'] as const;
type PreFilterModeEnv = typeof VALID_PREFILTER_MODES[number];

function parsePrefilterMode(raw: string | undefined): PreFilterModeEnv {
  const value = raw ?? 'soft';
  if (!(VALID_PREFILTER_MODES as readonly string[]).includes(value)) {
    throw new Error(
      `RAG_METADATA_PREFILTER_MODE must be one of: ${VALID_PREFILTER_MODES.join(', ')}; got "${value}"`,
    );
  }
  return value as PreFilterModeEnv;
}

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
    /**
     * Field-weighted sparse ranking weight vector for `ts_rank_cd`. Four
     * numbers reading (D, C, B, A). Default `[0.1, 0.2, 0.4, 1.0]` gives the
     * A-weight slot (title + section_path + entities on representation rows)
     * a 10x multiplier over D-slot lexemes. Configure via `RAG_SPARSE_WEIGHTS`
     * as a PG array literal: `RAG_SPARSE_WEIGHTS="{0.1,0.2,0.4,1.0}"`.
     */
    sparseWeights: parseSparseWeights(process.env['RAG_SPARSE_WEIGHTS']),
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
    enabled: process.env['RAG_GRAPH_ENABLED'] === 'true',
    maxHops: Number(process.env['RAG_GRAPH_MAX_HOPS']) || 2,
    hopDecay: Number(process.env['RAG_GRAPH_HOP_DECAY']) || 0.6,
    topologyWeight: Number(process.env['RAG_GRAPH_TOPOLOGY_WEIGHT']) || 0.4,
    relevanceWeight:
      Number(process.env['RAG_GRAPH_RELEVANCE_WEIGHT']) || 0.6,
    minEntityConfidence:
      Number(process.env['RAG_GRAPH_MIN_ENTITY_CONFIDENCE']) || 0.7,
    minRelationConfidence:
      Number(process.env['RAG_GRAPH_MIN_RELATION_CONFIDENCE']) || 0.5,
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
  metadataPrefilter: {
    mode: parsePrefilterMode(process.env['RAG_METADATA_PREFILTER_MODE']),
    hardMinConfidence: Number(process.env['RAG_METADATA_HARD_FILTER_MIN_CONFIDENCE']) || 0.85,
    llmFallbackEnabled: process.env['RAG_METADATA_LLM_FALLBACK_ENABLED'] === 'true',
    llmTimeoutMs: Number(process.env['RAG_METADATA_LLM_TIMEOUT_MS']) || 1500,
    llmConcurrency: Number(process.env['RAG_METADATA_LLM_CONCURRENCY']) || 4,
    minCandidatesByClass: parseMinCandidatesByClass(process.env['RAG_METADATA_MIN_CANDIDATES_BY_CLASS']),
  },
  parser: {
    url: process.env['PARSER_URL'] ?? 'http://localhost:8110',
    timeoutMs: Number(process.env['RAG_PARSER_TIMEOUT_MS']) || 30_000,
    minMarkdownChars: Number(process.env['RAG_PARSER_MIN_MARKDOWN_CHARS']) || 50,
    uploadMaxBytes: Number(process.env['RAG_UPLOAD_MAX_BYTES']) || 100 * 1024 * 1024,
  },
}));
