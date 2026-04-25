import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { knowledgeRelations, knowledgeEntities, chunkEntityLinks } from '@finsentinel/db';
import { GraphEnrichConsumer } from '../graph-enrich.consumer';
import type { Job } from 'bullmq';
import type { GraphEnrichJobData } from '../graph-enrich.producer';

// ── Helpers ────────────────────────────────────────────────────────────────────

const CHUNK_A = { id: 'chunk-a', content: 'Apple Inc. supplies components to Samsung.' };
const CHUNK_B = { id: 'chunk-b', content: 'TSMC manufactures chips.' };

const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:Name');

function isRelationTable(table: unknown): boolean {
  return (table as any)?.[DRIZZLE_TABLE_NAME] === 'knowledge_relations';
}

function makeDb(
  opts: {
    chunks?: Array<{ id: string; content: string }>;
    existingEntities?: Array<{ id: string }>;
    existingRelations?: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relation_type: string;
      source_chunk_id: string;
    }>;
  } = {},
) {
  const { chunks = [CHUNK_A, CHUNK_B], existingEntities = [], existingRelations = [] } = opts;

  // select().from().where() chain
  // First call: chunk load; subsequent calls: entity lookup with .limit()
  let selectCallCount = 0;
  const selectMock = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      const where = vi.fn().mockResolvedValue(chunks);
      const from = vi.fn().mockReturnValue({ where });
      return { from };
    }
    // entity lookup
    const limit = vi.fn().mockResolvedValue(existingEntities);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  });

  const insertOnConflict = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: insertOnConflict });
  const insertMock = vi.fn().mockReturnValue({ values: insertValues });

  // execute: first call is dedup query (returns array), later calls are UPDATE statements
  let executeCallCount = 0;
  const executeMock = vi.fn().mockImplementation(() => {
    executeCallCount++;
    // The first execute in the relations path is the existing-relations dedup query
    return Promise.resolve(existingRelations);
  });

  return {
    select: selectMock,
    insert: insertMock,
    execute: executeMock,
    _insertValues: insertValues,
    _insertMock: insertMock,
    _executeMock: executeMock,
    _selectMock: selectMock,
  };
}

function makeConfigService(minConfidence = 0.5) {
  return {
    get: vi.fn().mockImplementation((key: string, def: unknown) => {
      if (key === 'RERANKER_URL') return 'http://localhost:8100';
      if (key === 'rag.graph.minRelationConfidence') return minConfidence;
      return def;
    }),
  };
}

function makeJob(data: GraphEnrichJobData): Job<GraphEnrichJobData> {
  return { data, id: 'job-1', attemptsMade: 0 } as unknown as Job<GraphEnrichJobData>;
}

function buildConsumer(
  db: ReturnType<typeof makeDb>,
  minConfidence = 0.5,
  metrics?: { incrementCounter: ReturnType<typeof vi.fn> },
): GraphEnrichConsumer {
  const consumer = new GraphEnrichConsumer(
    { host: 'localhost', port: 6379 } as any,
    db as any,
    makeConfigService(minConfidence) as any,
    metrics as any,
  );
  return consumer;
}

// ── Sidecar fetch mock helpers ─────────────────────────────────────────────────

function mockFetch(response: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    }),
  );
}

// Count how many times db.insert was called with the knowledge_relations table
function countRelationInserts(db: ReturnType<typeof makeDb>): number {
  return (db._insertMock as MockedFunction<any>).mock.calls.filter(([table]: [unknown]) =>
    isRelationTable(table),
  ).length;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GraphEnrichConsumer.process', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('entities only response — no relation INSERTs', async () => {
    const db = makeDb();
    const consumer = buildConsumer(db);

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
      ],
      latency_ms: 5,
      // no relations field
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(countRelationInserts(db)).toBe(0);
  });

  it('unknown relation_type in response — bad row WARN logged, bad row dropped, entities still processed', async () => {
    const db = makeDb({ existingRelations: [] });
    const consumer = buildConsumer(db);

    const warnSpy = vi.spyOn((consumer as any).logger, 'warn');

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
      ],
      relations: [
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'INVALID_TYPE_XYZ',
          confidence: 0.9,
          evidence: 'bad row',
          source_chunk_index: 0,
        },
      ],
      latency_ms: 10,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    // Per-row drop: warn logged for the bad row, but the whole response is NOT aborted.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropping malformed relation'));
    // Bad relation is dropped.
    expect(countRelationInserts(db)).toBe(0);
  });

  it('2 valid relations pass when all zod valid', async () => {
    const db = makeDb({ existingRelations: [] });
    const consumer = buildConsumer(db);

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
        { name: 'Samsung', type: 'COMPANY', confidence: 0.8, mention_text: 'Samsung' },
      ],
      relations: [
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.87,
          evidence: 'Apple supplies TSMC',
          source_chunk_index: 0,
        },
        {
          source: 'Apple Inc.',
          target: 'Samsung',
          relation_type: 'COMPETES_WITH',
          confidence: 0.75,
          evidence: 'Apple competes with Samsung',
          source_chunk_index: 0,
        },
      ],
      latency_ms: 10,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(countRelationInserts(db)).toBe(2);
  });

  it('relation with missing source entity is dropped silently', async () => {
    const db = makeDb({ existingRelations: [] });
    const consumer = buildConsumer(db);

    const debugSpy = vi.spyOn((consumer as any).logger, 'debug');

    mockFetch({
      entities: [
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
        // "Apple Inc." is NOT in the entity list
      ],
      relations: [
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.87,
          evidence: 'Apple supplies TSMC',
          source_chunk_index: 0,
        },
      ],
      latency_ms: 5,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(countRelationInserts(db)).toBe(0);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('source entity'));
  });

  it('relation with confidence below threshold is dropped', async () => {
    const db = makeDb({ existingRelations: [] });
    const consumer = buildConsumer(db, 0.7); // threshold 0.7

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
      ],
      relations: [
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.5,
          evidence: 'low confidence',
          source_chunk_index: 0,
        },
      ],
      latency_ms: 5,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(countRelationInserts(db)).toBe(0);
  });

  it('duplicate (same source/target/type for same chunk) — only 1 INSERT', async () => {
    const db = makeDb({ existingRelations: [] });
    const consumer = buildConsumer(db);

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
      ],
      relations: [
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.87,
          evidence: 'first',
          source_chunk_index: 0,
        },
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.88,
          evidence: 'duplicate',
          source_chunk_index: 0,
        },
      ],
      latency_ms: 5,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(countRelationInserts(db)).toBe(1);
  });

  it('every relation INSERT row has all 8 columns set explicitly', async () => {
    const db = makeDb({ existingRelations: [] });
    const consumer = buildConsumer(db);

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
      ],
      relations: [
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.87,
          evidence: 'Apple supplies TSMC',
          source_chunk_index: 0,
        },
      ],
      latency_ms: 5,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(countRelationInserts(db)).toBe(1);

    // The values() call after the relation insert() captures the row object
    const valuesCallArgs = (db._insertValues as MockedFunction<any>).mock.calls;
    // Find the call that has relation columns (sourceEntityId present)
    const relationValueCalls = valuesCallArgs.filter(
      ([row]: [any]) => 'sourceEntityId' in row && 'targetEntityId' in row && 'relationType' in row,
    );
    expect(relationValueCalls.length).toBeGreaterThanOrEqual(1);
    const row = relationValueCalls[0]![0];
    expect(row).toHaveProperty('id');
    expect(row).toHaveProperty('sourceEntityId');
    expect(row).toHaveProperty('targetEntityId');
    expect(row).toHaveProperty('relationType', 'SUPPLIES_TO');
    expect(row).toHaveProperty('confidence', 0.87);
    expect(row).toHaveProperty('evidence', 'Apple supplies TSMC');
    expect(row).toHaveProperty('sourceChunkId', CHUNK_A.id);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('skips relation with source_chunk_index out of bounds', async () => {
    const db = makeDb({ chunks: [CHUNK_A], existingRelations: [] });
    const consumer = buildConsumer(db);

    const warnSpy = vi.spyOn((consumer as any).logger, 'warn');

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
      ],
      relations: [
        // chunk index 5 doesn't exist (only chunk at index 0)
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.87,
          evidence: 'oob',
          source_chunk_index: 5,
        },
      ],
      latency_ms: 5,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(countRelationInserts(db)).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('source_chunk_index'));
  });

  it('returns early with no chunks without calling sidecar', async () => {
    const db = makeDb({ chunks: [] });
    const consumer = buildConsumer(db);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-empty' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('increments counter per inserted relation with relation_type label', async () => {
    const db = makeDb({ existingRelations: [] });
    const metrics = { incrementCounter: vi.fn() };
    const consumer = buildConsumer(db, 0.5, metrics);

    mockFetch({
      entities: [
        { name: 'Apple Inc.', type: 'COMPANY', confidence: 0.9, mention_text: 'Apple Inc.' },
        { name: 'TSMC', type: 'TICKER', confidence: 0.85, mention_text: 'TSMC' },
        { name: 'Samsung', type: 'COMPANY', confidence: 0.8, mention_text: 'Samsung' },
      ],
      relations: [
        {
          source: 'Apple Inc.',
          target: 'TSMC',
          relation_type: 'SUPPLIES_TO',
          confidence: 0.87,
          evidence: 'Apple supplies TSMC',
          source_chunk_index: 0,
        },
        {
          source: 'Apple Inc.',
          target: 'Samsung',
          relation_type: 'COMPETES_WITH',
          confidence: 0.75,
          evidence: 'Apple competes with Samsung',
          source_chunk_index: 0,
        },
      ],
      latency_ms: 10,
    });

    await consumer.process(makeJob({ sourceType: 'document', sourceId: 'doc-1' }));

    expect(metrics.incrementCounter).toHaveBeenCalledTimes(2);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_graph_relations_inserted_total',
      'Total knowledge_relations rows inserted by graph enrichment',
      { relation_type: 'SUPPLIES_TO' },
    );
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_graph_relations_inserted_total',
      'Total knowledge_relations rows inserted by graph enrichment',
      { relation_type: 'COMPETES_WITH' },
    );
  });
});
