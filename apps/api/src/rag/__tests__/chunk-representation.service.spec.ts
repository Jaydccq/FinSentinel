import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ChunkRepresentationService,
  ChunkNotFoundError,
  CURRENT_REPRESENTATION_VERSION,
  REPRESENTATION_LLM_CLIENT,
} from '../chunk-representation.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { MetricsService } from '../../common/services/metrics.service';
import { aiConfig } from '../../config/ai.config';

// ── Constants ──────────────────────────────────────────────────────────────────

const VALID_LLM_RESPONSE = JSON.stringify({
  contextual: 'This is contextual text about the document section providing 40-80 words of context to the chunk.',
  sample_questions: ['What is the revenue growth rate for Q3?', 'How did operating margins change year over year?'],
  summary: 'Revenue grew 15% year over year driven by software segment expansion.',
  keywords: ['revenue', 'Q3', 'operating margins', 'software', 'growth'],
});

function makeChunkRow(overrides: Partial<{
  id: string;
  content: string;
  enrichmentStatus: string;
  metaTitle: string | null;
  sectionPath: string | null;
}> = {}) {
  return {
    id: 'chunk-uuid-1',
    content: 'Revenue for Q3 grew 15% year over year.',
    enrichmentStatus: 'pending',
    metaTitle: 'Q3 Earnings Report',
    sectionPath: 'Financial Results > Revenue',
    ...overrides,
  };
}

// ── Mock DB factory ────────────────────────────────────────────────────────────
//
// The service makes two separate .select() calls per enrichChunk:
//   call 1 (chunk load):       .select().from(documentChunks).where(...).limit(1)
//   call 2 (idempotency check): .select().from(documentChunkRepresentations).where(...).limit(1)
//
// We use a call-count-based dispatch on db.select so each invocation gets
// its own independent chain, controlled via selectCallResults.

function createMockDb(
  selectCallResults: Array<unknown[]> = [
    [makeChunkRow()], // call 1: chunk load
    [],               // call 2: idempotency check → empty = not yet enriched
  ],
) {
  let selectCallCount = 0;
  const capturedLimitMocks: ReturnType<typeof vi.fn>[] = [];
  const capturedValuesMocks: ReturnType<typeof vi.fn>[] = [];

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  const selectFn = vi.fn().mockImplementation(() => {
    const callIndex = selectCallCount++;
    const result = selectCallResults[callIndex] ?? [];
    const limitMock = vi.fn().mockResolvedValue(result);
    capturedLimitMocks.push(limitMock);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    return { from: vi.fn().mockReturnValue({ where: whereMock }) };
  });

  return {
    select: selectFn,
    update: updateFn,
    insert: insertFn,
    delete: deleteFn,
    _mocks: {
      selectFn,
      updateFn,
      updateSet,
      updateWhere,
      insertFn,
      insertValues,
      deleteFn,
      deleteWhere,
      capturedLimitMocks,
      capturedValuesMocks,
    },
    // Helper: reset call count and results for multi-call tests
    _resetSelectResults(newResults: Array<unknown[]>) {
      selectCallCount = 0;
      selectCallResults.splice(0, selectCallResults.length, ...newResults);
      capturedLimitMocks.splice(0);
    },
  };
}

function createMockLlm(response: string = VALID_LLM_RESPONSE) {
  return {
    generate: vi.fn().mockResolvedValue(response),
  };
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ChunkRepresentationService', () => {
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

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('inserts 4 representation rows and sets chunk status to succeeded', async () => {
    const result = await service.enrichChunk('chunk-uuid-1');

    expect(result.status).toBe('succeeded');
    expect(result.representationsWritten).toBe(4);

    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(embedding.embedQuery).toHaveBeenCalledTimes(2);
    expect(db._mocks.insertValues).toHaveBeenCalledTimes(1);

    const insertArg = db._mocks.insertValues.mock.calls[0]![0] as unknown[];
    expect(insertArg).toHaveLength(4);

    const updateCalls = db._mocks.updateSet.mock.calls;
    const lastUpdate = updateCalls[updateCalls.length - 1]![0] as Record<string, unknown>;
    expect(lastUpdate['enrichmentStatus']).toBe('succeeded');
  });

  it('every INSERT row explicitly sets all 10 columns', async () => {
    await service.enrichChunk('chunk-uuid-1');

    const rows = db._mocks.insertValues.mock.calls[0]![0] as Record<string, unknown>[];
    expect(rows).toHaveLength(4);

    const requiredColumns = [
      'id',
      'chunkId',
      'representationType',
      'content',
      'embedding',
      'searchVector',
      'weight',
      'metadata',
      'createdAt',
      'updatedAt',
    ];

    for (const row of rows) {
      for (const col of requiredColumns) {
        expect(
          Object.prototype.hasOwnProperty.call(row, col),
          `column '${col}' must be present in row with type '${row['representationType']}'`,
        ).toBe(true);
      }
    }
  });

  it('contextual_text and sample_question rows have non-null embeddings; summary and keyword_entity do not', async () => {
    await service.enrichChunk('chunk-uuid-1');

    const rows = db._mocks.insertValues.mock.calls[0]![0] as Array<{
      representationType: string;
      embedding: number[] | null;
    }>;

    const byType = Object.fromEntries(rows.map((r) => [r.representationType, r]));

    expect(byType['contextual_text']!.embedding).not.toBeNull();
    expect(byType['sample_question']!.embedding).not.toBeNull();
    expect(byType['summary']!.embedding).toBeNull();
    expect(byType['keyword_entity']!.embedding).toBeNull();
  });

  it('sets index_version in metadata to CURRENT_REPRESENTATION_VERSION', async () => {
    await service.enrichChunk('chunk-uuid-1');

    const rows = db._mocks.insertValues.mock.calls[0]![0] as Array<{
      metadata: Record<string, unknown>;
    }>;

    for (const row of rows) {
      expect(row.metadata['index_version']).toBe(CURRENT_REPRESENTATION_VERSION);
    }
  });

  // ── Idempotency: already enriched at current version ──────────────────────

  it('skips enrichment if rows already exist at current version', async () => {
    const freshDb = createMockDb([
      [makeChunkRow()],           // chunk load
      [{ id: 'existing-row' }],   // idempotency check returns a hit
    ]);
    const freshService = await buildService(freshDb, llm, embedding, metrics);

    const result = await freshService.enrichChunk('chunk-uuid-1');

    expect(result.status).toBe('skipped');
    expect(result.representationsWritten).toBe(0);
    expect(llm.generate).not.toHaveBeenCalled();
    expect(embedding.embedQuery).not.toHaveBeenCalled();
  });

  // ── Invalid LLM JSON: 1 retry then fail ───────────────────────────────────

  it('retries once on invalid JSON then marks chunk as failed', async () => {
    llm.generate.mockResolvedValue('not valid json at all {{{');

    const result = await service.enrichChunk('chunk-uuid-1');

    expect(result.status).toBe('failed');
    expect(result.representationsWritten).toBe(0);
    // Two LLM calls: attempt 0 + retry attempt 1
    expect(llm.generate).toHaveBeenCalledTimes(2);
    expect(embedding.embedQuery).not.toHaveBeenCalled();

    const updateCalls = db._mocks.updateSet.mock.calls;
    const lastUpdate = updateCalls[updateCalls.length - 1]![0] as Record<string, unknown>;
    expect(lastUpdate['enrichmentStatus']).toBe('failed');
  });

  // ── Embedding failure after LLM success ───────────────────────────────────

  it('rolls back representation rows and marks failed when embedding throws', async () => {
    embedding.embedQuery.mockRejectedValue(new Error('embedding API error'));

    const result = await service.enrichChunk('chunk-uuid-1');

    expect(result.status).toBe('failed');
    expect(result.representationsWritten).toBe(0);
    expect(db._mocks.deleteFn).toHaveBeenCalled();

    const updateCalls = db._mocks.updateSet.mock.calls;
    const lastUpdate = updateCalls[updateCalls.length - 1]![0] as Record<string, unknown>;
    expect(lastUpdate['enrichmentStatus']).toBe('failed');
  });

  // ── Chunk not found ───────────────────────────────────────────────────────

  it('throws ChunkNotFoundError when chunk is not found in DB', async () => {
    const notFoundDb = createMockDb([[]]);  // select returns empty → chunk not found
    const notFoundService = await buildService(notFoundDb, llm, embedding, metrics);

    await expect(notFoundService.enrichChunk('nonexistent-chunk')).rejects.toThrow(ChunkNotFoundError);
    await expect(notFoundService.enrichChunk('nonexistent-chunk')).rejects.toThrow('chunk not found: nonexistent-chunk');
  });

  // ── Circuit breaker ───────────────────────────────────────────────────────

  it('trips after 5 consecutive 429 errors and short-circuits subsequent calls', async () => {
    const error429 = new Error('429 Too Many Requests rate limit exceeded');
    llm.generate.mockRejectedValue(error429);

    // Provide enough select results: each enrichChunk call needs chunk + idempotency
    const manyResults: Array<unknown[]> = [];
    for (let i = 0; i < 20; i++) {
      manyResults.push([makeChunkRow()]);  // odd calls: chunk load
      manyResults.push([]);                // even calls: idempotency check
    }
    const cbDb = createMockDb(manyResults);
    const freshService = await buildService(cbDb, llm, embedding, metrics);

    let cbTripDetected = false;
    for (let i = 0; i < 15; i++) {
      const result = await freshService.enrichChunk('chunk-uuid-1');
      if (result.reason?.includes('circuit breaker open')) {
        cbTripDetected = true;
        // Verify next call also short-circuits without calling LLM
        const callsBefore = llm.generate.mock.calls.length;
        const nextResult = await freshService.enrichChunk('chunk-uuid-1');
        expect(nextResult.reason).toContain('circuit breaker open');
        const callsAfter = llm.generate.mock.calls.length;
        expect(callsAfter).toBe(callsBefore);
        break;
      }
    }

    expect(cbTripDetected).toBe(true);
  });

  it('resets circuit breaker counter after a successful LLM call', async () => {
    const error429 = new Error('429 rate limit');
    // Both retry attempts of first call fail with 429 → 2 errors recorded
    // Second call succeeds → counter resets
    llm.generate
      .mockRejectedValueOnce(error429)  // attempt 0 of call 1
      .mockRejectedValueOnce(error429)  // attempt 1 of call 1
      .mockResolvedValue(VALID_LLM_RESPONSE);  // call 2 succeeds

    const cbDb = createMockDb([
      [makeChunkRow()], [],  // call 1: chunk + idempotency
      [makeChunkRow()], [],  // call 2: chunk + idempotency
    ].flat().reduce<Array<unknown[]>>((acc, item, i) => {
      if (i % 2 === 0) acc.push([item as ReturnType<typeof makeChunkRow>]);
      else acc.push([]);
      return acc;
    }, []));
    // Simpler: just build the right array directly
    const simpleDb = createMockDb([
      [makeChunkRow()], // call 1 chunk
      [],               // call 1 idempotency
      [makeChunkRow()], // call 2 chunk
      [],               // call 2 idempotency
    ]);
    const freshService = await buildService(simpleDb, llm, embedding, metrics);

    // First enrichChunk call — LLM fails both attempts → 2 errors
    const result1 = await freshService.enrichChunk('chunk-uuid-1');
    expect(result1.status).toBe('failed');

    // Second enrichChunk call — LLM succeeds → counter resets, status = succeeded
    const result2 = await freshService.enrichChunk('chunk-uuid-1');
    expect(result2.status).toBe('succeeded');

    expect(freshService.getCurrentVersion()).toBe(CURRENT_REPRESENTATION_VERSION);
  });
});
