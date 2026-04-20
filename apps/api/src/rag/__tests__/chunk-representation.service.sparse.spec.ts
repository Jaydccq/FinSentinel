import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ChunkRepresentationService,
  REPRESENTATION_LLM_CLIENT,
} from '../chunk-representation.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { MetricsService } from '../../common/services/metrics.service';
import { aiConfig } from '../../config/ai.config';

// ── R2.1: failing test — representation insert must populate search_vector ────
//
// Goal: every row inserted into document_chunk_representations must have a
// non-null search_vector expressed as a parameterised Drizzle `sql``` fragment
// using to_tsvector('simple', …) with setweight() field weighting. Today the
// service writes `searchVector: null`, so sparse search via representations
// silently returns zero hits (CLAUDE.md codex finding #5).

const VALID_LLM_RESPONSE = JSON.stringify({
  contextual: 'Apple Inc. reported Q4 2025 revenue of $119.58 billion, up 15% YoY, driven by iPhone 17 sales and services growth across all geographies.',
  sample_questions: [
    'What was Apple Q4 2025 revenue?',
    'How did iPhone 17 perform in Q4 2025?',
  ],
  summary: 'Apple Q4 2025 revenue rose 15% YoY to $119.58 billion on iPhone 17 and services growth.',
  keywords: ['apple', 'iphone 17', 'q4 2025', 'revenue', 'services'],
});

function makeChunkRow() {
  return {
    id: 'chunk-uuid-sparse',
    content: 'Apple Inc. reported Q4 2025 revenue of $119.58 billion.',
    enrichmentStatus: 'pending',
    metaTitle: 'Apple Q4 2025 Earnings',
    sectionPath: 'Financial Results > Revenue',
  };
}

function createMockDb() {
  const selectResults: Array<unknown[]> = [
    [makeChunkRow()], // chunk load
    [],               // idempotency check
  ];
  let selectCallCount = 0;

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  const selectFn = vi.fn().mockImplementation(() => {
    const callIndex = selectCallCount++;
    const result = selectResults[callIndex] ?? [];
    const limitMock = vi.fn().mockResolvedValue(result);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    return { from: vi.fn().mockReturnValue({ where: whereMock }) };
  });

  return {
    select: selectFn,
    update: updateFn,
    insert: insertFn,
    delete: deleteFn,
    _mocks: { insertValues },
  };
}

function createMockLlm() {
  return { generate: vi.fn().mockResolvedValue(VALID_LLM_RESPONSE) };
}

function createMockEmbeddingService() {
  return {
    embedQuery: vi.fn().mockImplementation(async (text: string) =>
      Array(1536).fill(0).map((_, i) => i / 1536 + text.length * 0.0001),
    ),
    embedChunks: vi.fn().mockResolvedValue([]),
  };
}

function createMockMetrics() {
  return {
    incrementCounter: vi.fn(),
    observeHistogram: vi.fn(),
    setGauge: vi.fn(),
    startHistogramTimer: vi.fn(() => vi.fn()),
  };
}

const mockAiConfig = {
  openrouterApiKey: 'test-key',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash-preview',
  embeddingModel: 'text-embedding-3-small',
};

async function buildService(
  db: ReturnType<typeof createMockDb>,
  llm: ReturnType<typeof createMockLlm>,
  embedding: ReturnType<typeof createMockEmbeddingService>,
  metrics: ReturnType<typeof createMockMetrics>,
) {
  const module = await Test.createTestingModule({
    providers: [
      ChunkRepresentationService,
      { provide: 'DRIZZLE_DB', useValue: db },
      { provide: REPRESENTATION_LLM_CLIENT, useValue: llm },
      { provide: RagEmbeddingService, useValue: embedding },
      { provide: MetricsService, useValue: metrics },
      { provide: aiConfig.KEY, useValue: mockAiConfig },
      { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue(undefined) } },
    ],
  }).compile();

  return module.get(ChunkRepresentationService);
}

/**
 * Extract the SQL text from a Drizzle `sql``` fragment by introspecting the
 * `queryChunks` / `sql.chunks` array. We avoid touching any internal parameter
 * list here — we only assert on the template literal text so we can detect the
 * tsvector shape without relying on private API surface.
 */
function getSqlText(fragment: unknown): string {
  if (!fragment || typeof fragment !== 'object') return String(fragment);
  const f = fragment as { queryChunks?: unknown[]; chunks?: unknown[] };
  const chunks = f.queryChunks ?? f.chunks;
  if (!chunks) return String(fragment);
  // Drizzle template chunks are either a StringChunk ({value: [string]}) for
  // literals or a parameter value for bindings. Only literals contribute SQL
  // text; parameter values must be rendered as a placeholder so tests can't
  // accidentally assert on user-supplied data.
  return chunks
    .map((c) => {
      if (c && typeof c === 'object') {
        const rec = c as { value?: unknown };
        if (Array.isArray(rec.value) && rec.value.every((v) => typeof v === 'string')) {
          return (rec.value as string[]).join('');
        }
        return '<<param>>';
      }
      return '<<param>>';
    })
    .join('');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ChunkRepresentationService search_vector population (R2.1)', () => {
  let db: ReturnType<typeof createMockDb>;
  let llm: ReturnType<typeof createMockLlm>;
  let embedding: ReturnType<typeof createMockEmbeddingService>;
  let metrics: ReturnType<typeof createMockMetrics>;
  let service: ChunkRepresentationService;

  beforeEach(async () => {
    db = createMockDb();
    llm = createMockLlm();
    embedding = createMockEmbeddingService();
    metrics = createMockMetrics();
    service = await buildService(db, llm, embedding, metrics);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates search_vector for every representation type on insert', async () => {
    const result = await service.enrichChunk('chunk-uuid-sparse');
    expect(result.status).toBe('succeeded');

    const rows = db._mocks.insertValues.mock.calls[0]![0] as Array<{
      representationType: string;
      searchVector: unknown;
    }>;

    expect(rows).toHaveLength(4);

    for (const row of rows) {
      expect(
        row.searchVector,
        `row with type '${row.representationType}' must set searchVector to a non-null SQL fragment`,
      ).not.toBeNull();
      expect(
        row.searchVector,
        `row with type '${row.representationType}' must set searchVector to a defined value`,
      ).toBeDefined();
    }
  });

  it('uses to_tsvector with simple config (matches websearch_to_tsquery in SparseSearchService)', async () => {
    await service.enrichChunk('chunk-uuid-sparse');

    const rows = db._mocks.insertValues.mock.calls[0]![0] as Array<{
      representationType: string;
      searchVector: unknown;
    }>;

    for (const row of rows) {
      const text = getSqlText(row.searchVector);
      // If SQL-introspection yields anything at all, it must reference the
      // simple tsvector config. (A fragment that resolved to plain "null" or
      // equivalent would fail this assertion, catching the pre-R2 regression.)
      expect(
        text.toLowerCase(),
        `row with type '${row.representationType}' must build a to_tsvector('simple', ...) expression. ` +
          `Got SQL fragment shape: ${text}`,
      ).toContain(`to_tsvector('simple'`);
    }
  });

  it('applies setweight for field-weighted ranking on every row', async () => {
    await service.enrichChunk('chunk-uuid-sparse');

    const rows = db._mocks.insertValues.mock.calls[0]![0] as Array<{
      representationType: string;
      searchVector: unknown;
    }>;

    for (const row of rows) {
      const text = getSqlText(row.searchVector);
      expect(
        text.toLowerCase(),
        `row with type '${row.representationType}' must use setweight(...) for field weighting`,
      ).toContain('setweight');
    }
  });

  // ── R2.7: Prometheus counter for sparse-lane health ──────────────────────────
  it('increments rag_representation_sparse_populated_total once per representation type on successful insert', async () => {
    await service.enrichChunk('chunk-uuid-sparse');

    const calls = (metrics.incrementCounter as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === 'rag_representation_sparse_populated_total',
    );
    expect(calls).toHaveLength(4);

    const types = calls.map((args: unknown[]) => (args[2] as Record<string, string>).type).sort();
    expect(types).toEqual(['contextual_text', 'keyword_entity', 'sample_question', 'summary']);

    for (const call of calls) {
      expect((call[2] as Record<string, string>).source).toBe('insert');
    }
  });
});
