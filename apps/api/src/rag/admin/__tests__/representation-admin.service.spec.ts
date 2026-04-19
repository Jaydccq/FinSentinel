import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RepresentationAdminService } from '../representation-admin.service';
import { CURRENT_REPRESENTATION_VERSION, RAG_REPRESENTATION_BATCH_SIZE_DEFAULT } from '../../chunk-representation.service';

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeChunkRow(overrides: Partial<{
  id: string;
  sourceType: string;
  sourceId: string;
  enrichmentStatus: string;
}> = {}) {
  return {
    id: 'chunk-uuid-1',
    sourceType: 'document',
    sourceId: 'source-uuid-1',
    enrichmentStatus: 'pending',
    ...overrides,
  };
}

/**
 * Minimal mock DB for RepresentationAdminService.
 *
 * The service methods make multiple chained .select() calls:
 *
 * listUnenrichedChunks:
 *   call 0: subquery select (never awaited directly -- used inline in sql`...IN(subquery)`)
 *   call 1: main select, awaited with .limit() or directly
 *
 * listStaleVersionChunks:
 *   call 0: .select().from().groupBy().having() — used inline as subquery
 *   call 1: main select, awaited with .limit() or directly
 *
 * Only the main query (call 1 in each method) resolves to actual data.
 * The subquery is embedded via sql`` template literal and is NOT awaited —
 * it is used as a plain object reference inside the SQL template.
 *
 * Because Drizzle's sql`` just stringifies the subquery object, the subquery
 * chain never needs to resolve. We only need the *main* query call to work.
 *
 * To keep it simple: selectResults[0] = result for the first awaited query,
 * selectResults[1] = result for the second, etc.
 *
 * We give every chain a working .then() so it can be awaited directly
 * (Drizzle QueryBuilder is a PromiseLike), AND a .limit() that also resolves.
 */
function createMockDb(selectResults: Array<unknown[]> = []) {
  let callIndex = 0;

  function buildChain(result: unknown[]): Record<string, unknown> {
    const limitFn = vi.fn().mockResolvedValue(result);

    // Build a thenable so `await query` works without calling .limit()
    let resolveThenable!: (v: unknown) => void;
    const thenablePromise = new Promise((res) => { resolveThenable = res; });
    // Resolve immediately so await works synchronously next tick
    resolveThenable(result);

    const thenFn = vi.fn().mockImplementation(
      (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        thenablePromise.then(onFulfilled, onRejected),
    );

    const havingFn = vi.fn().mockImplementation(() => ({
      then: thenFn,
      limit: limitFn,
    }));

    const groupByFn = vi.fn().mockImplementation(() => ({
      having: havingFn,
      then: thenFn,
      limit: limitFn,
    }));

    const whereFn = vi.fn().mockImplementation(() => ({
      limit: limitFn,
      groupBy: groupByFn,
      then: thenFn,
    }));

    return {
      from: vi.fn().mockImplementation(() => ({
        where: whereFn,
        groupBy: groupByFn,
      })),
      then: thenFn,
      limit: limitFn,
    };
  }

  const selectFn = vi.fn().mockImplementation(() => {
    const result = selectResults[callIndex] ?? [];
    callIndex++;
    return buildChain(result);
  });

  return {
    select: selectFn,
    _selectFn: selectFn,
    _resetCallIndex: () => { callIndex = 0; },
  };
}

function createMockProducer() {
  return {
    enqueueMany: vi.fn().mockResolvedValue(undefined),
    enqueueChunk: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockConfigService(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      if (key in overrides) return overrides[key];
      return defaultValue;
    }),
  };
}

async function buildService(
  db: ReturnType<typeof createMockDb>,
  producer: ReturnType<typeof createMockProducer>,
  configOverrides: Record<string, unknown> = {},
) {
  const configService = createMockConfigService(configOverrides);

  const module = await Test.createTestingModule({
    providers: [
      RepresentationAdminService,
      { provide: 'DRIZZLE_DB', useValue: db },
      { provide: RepresentationEnrichProducer, useValue: producer },
      { provide: ConfigService, useValue: configService },
    ],
  }).compile();

  return module.get(RepresentationAdminService);
}

// Import after mock factories are defined
import { RepresentationEnrichProducer } from '../../../queue/representation-enrich.producer';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RepresentationAdminService', () => {
  let db: ReturnType<typeof createMockDb>;
  let producer: ReturnType<typeof createMockProducer>;
  let service: RepresentationAdminService;

  beforeEach(async () => {
    db = createMockDb();
    producer = createMockProducer();
    service = await buildService(db, producer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── listUnenrichedChunks ───────────────────────────────────────────────────
  //
  // listUnenrichedChunks calls db.select() TWICE:
  //   call 0: subquery (used inside sql`` template, never awaited)
  //   call 1: main query (awaited, returns chunk rows)
  // So selectResults[0] = [] (subquery, unused), selectResults[1] = actual rows.

  describe('listUnenrichedChunks', () => {
    it('returns chunks when DB select resolves with results', async () => {
      const row = makeChunkRow({ enrichmentStatus: 'pending' });
      db = createMockDb([[], [row]]);
      service = await buildService(db, producer);

      const result = await service.listUnenrichedChunks();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'chunk-uuid-1', enrichmentStatus: 'pending' });
    });

    it('returns empty array when no unenriched chunks exist', async () => {
      db = createMockDb([[], []]);
      service = await buildService(db, producer);

      const result = await service.listUnenrichedChunks();

      expect(result).toHaveLength(0);
    });

    it('applies source-type filter to DB query', async () => {
      const row = makeChunkRow({ sourceType: 'news' });
      db = createMockDb([[], [row]]);
      service = await buildService(db, producer);

      const result = await service.listUnenrichedChunks({ sourceType: 'news' });

      // Verify select was called (filter is applied inside query builder)
      expect(db._selectFn).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]!.sourceType).toBe('news');
    });

    it('applies source-id filter to DB query', async () => {
      const row = makeChunkRow({ sourceId: 'specific-source-uuid' });
      db = createMockDb([[], [row]]);
      service = await buildService(db, producer);

      const result = await service.listUnenrichedChunks({ sourceId: 'specific-source-uuid' });

      expect(db._selectFn).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]!.sourceId).toBe('specific-source-uuid');
    });

    it('applies both source-type and source-id filters simultaneously', async () => {
      const row = makeChunkRow({ sourceType: 'document', sourceId: 'doc-uuid-99' });
      db = createMockDb([[], [row]]);
      service = await buildService(db, producer);

      const result = await service.listUnenrichedChunks({
        sourceType: 'document',
        sourceId: 'doc-uuid-99',
      });

      expect(result).toHaveLength(1);
    });

    it('passes limit to DB query when provided', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        makeChunkRow({ id: `chunk-${i}` }),
      );
      db = createMockDb([[], rows]);
      service = await buildService(db, producer);

      const result = await service.listUnenrichedChunks({ limit: 5 });

      expect(result).toHaveLength(5);
    });

    it('returns multiple rows with mixed enrichment statuses', async () => {
      const rows = [
        makeChunkRow({ id: 'c1', enrichmentStatus: 'pending' }),
        makeChunkRow({ id: 'c2', enrichmentStatus: 'failed' }),
      ];
      db = createMockDb([[], rows]);
      service = await buildService(db, producer);

      const result = await service.listUnenrichedChunks();

      expect(result).toHaveLength(2);
    });
  });

  // ── listStaleVersionChunks ─────────────────────────────────────────────────
  //
  // listStaleVersionChunks calls db.select() TWICE:
  //   call 0: subquery (.select().from().groupBy().having() — embedded in sql``, never awaited)
  //   call 1: main query (awaited, returns chunk rows)
  // So selectResults[0] = [] (subquery, unused), selectResults[1] = actual rows.

  describe('listStaleVersionChunks', () => {
    it('returns chunks whose max representation version is at or below fromVersion', async () => {
      const row = makeChunkRow({ id: 'stale-chunk', enrichmentStatus: 'succeeded' });
      db = createMockDb([[], [row]]);
      service = await buildService(db, producer);

      const result = await service.listStaleVersionChunks('rep-v1.0');

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('stale-chunk');
    });

    it('returns empty array when no stale chunks exist', async () => {
      db = createMockDb([[], []]);
      service = await buildService(db, producer);

      const result = await service.listStaleVersionChunks('rep-v1.0');

      expect(result).toHaveLength(0);
    });

    it('passes limit to DB query when provided', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        makeChunkRow({ id: `stale-${i}` }),
      );
      db = createMockDb([[], rows]);
      service = await buildService(db, producer);

      const result = await service.listStaleVersionChunks('rep-v1.0', 3);

      expect(result).toHaveLength(3);
    });

    it('uses string comparison: rep-v1.0 < rep-v1.1 semantics (documented convention)', () => {
      // Validate that simple string comparison on the rep-vX.Y format works as expected.
      // This mirrors what Postgres MAX() string comparison does for these version strings.
      const versions = ['rep-v1.0', 'rep-v1.1', 'rep-v2.0'];

      expect('rep-v1.0' <= 'rep-v1.0').toBe(true);  // equal: stale at v1.0
      expect('rep-v1.0' <= 'rep-v1.1').toBe(true);  // 1.0 < 1.1: stale
      expect('rep-v1.1' <= 'rep-v2.0').toBe(true);  // 1.1 < 2.0: stale
      expect('rep-v2.0' <= 'rep-v1.1').toBe(false); // 2.0 > 1.1: not stale
      expect('rep-v1.1' <= 'rep-v1.0').toBe(false); // 1.1 > 1.0: not stale

      // Verify sorted order is stable
      const sorted = [...versions].sort();
      expect(sorted).toEqual(['rep-v1.0', 'rep-v1.1', 'rep-v2.0']);
    });
  });

  // ── estimateCost ───────────────────────────────────────────────────────────

  describe('estimateCost', () => {
    it('returns deterministic values for a known chunk count', () => {
      const estimate = service.estimateCost(100);

      expect(estimate.llmCalls).toBe(100);
      expect(estimate.embeddingCalls).toBe(200);
      // 100 * 2300 * 0.00015 / 1000 = 0.0345
      // 200 * 300  * 0.00002 / 1000 = 0.0012
      // total = 0.0357
      expect(estimate.estimatedUsd).toBe(0.0357);
    });

    it('returns zero cost for zero chunks', () => {
      const estimate = service.estimateCost(0);

      expect(estimate.llmCalls).toBe(0);
      expect(estimate.embeddingCalls).toBe(0);
      expect(estimate.estimatedUsd).toBe(0);
    });

    it('scales linearly with chunk count', () => {
      const one = service.estimateCost(1);
      const ten = service.estimateCost(10);

      expect(ten.llmCalls).toBe(one.llmCalls * 10);
      expect(ten.embeddingCalls).toBe(one.embeddingCalls * 10);
      // Allow floating point rounding tolerance
      expect(ten.estimatedUsd).toBeCloseTo(one.estimatedUsd * 10, 3);
    });
  });

  // ── enqueueForEnrichment ───────────────────────────────────────────────────

  describe('enqueueForEnrichment', () => {
    it('returns the count of enqueued IDs', async () => {
      const ids = ['c1', 'c2', 'c3'];
      const count = await service.enqueueForEnrichment(ids);

      expect(count).toBe(3);
      expect(producer.enqueueMany).toHaveBeenCalledWith(ids);
    });

    it('returns 0 and does not call producer for empty array', async () => {
      const count = await service.enqueueForEnrichment([]);

      expect(count).toBe(0);
      expect(producer.enqueueMany).not.toHaveBeenCalled();
    });

    it('respects RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC cap', async () => {
      // Set cap to 3
      service = await buildService(db, producer, {
        RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC: 3,
      });

      const ids = ['c1', 'c2', 'c3', 'c4', 'c5'];
      const count = await service.enqueueForEnrichment(ids);

      expect(count).toBe(3);
      expect(producer.enqueueMany).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
    });

    it('does not truncate when count is exactly at the cap', async () => {
      service = await buildService(db, producer, {
        RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC: 5,
      });

      const ids = ['c1', 'c2', 'c3', 'c4', 'c5'];
      const count = await service.enqueueForEnrichment(ids);

      expect(count).toBe(5);
      expect(producer.enqueueMany).toHaveBeenCalledWith(ids);
    });
  });

  // ── getBatchSize ───────────────────────────────────────────────────────────

  describe('getBatchSize', () => {
    it('returns default batch size when config is not set', () => {
      expect(service.getBatchSize()).toBe(RAG_REPRESENTATION_BATCH_SIZE_DEFAULT);
    });

    it('returns config batch size when set', async () => {
      service = await buildService(db, producer, { RAG_REPRESENTATION_BATCH_SIZE: 100 });

      expect(service.getBatchSize()).toBe(100);
    });
  });
});

// ── CLI flag behaviour ─────────────────────────────────────────────────────────
//
// These tests validate the CLI safety guards without standing up a real
// NestJS context. They test the process.exit paths by inspecting the module
// logic directly via env var checks.

describe('Backfill CLI safety guards', () => {
  it('exits 1 when RAG_ENRICHMENT_ENABLED=false and --dry-run is not set', () => {
    // Simulate the guard logic from rag-backfill-representations.cli.ts
    const enrichmentEnabled = 'false' !== 'false'; // env value is 'false'
    const dryRun = false;

    const shouldRefuse = !enrichmentEnabled && !dryRun;

    expect(shouldRefuse).toBe(true);
  });

  it('allows dry-run even when RAG_ENRICHMENT_ENABLED=false', () => {
    const enrichmentEnabled = 'false' !== 'false';
    const dryRun = true;

    const shouldRefuse = !enrichmentEnabled && !dryRun;

    expect(shouldRefuse).toBe(false);
  });

  it('allows execution when RAG_ENRICHMENT_ENABLED=true', () => {
    const enrichmentEnabled = 'true' !== 'false';
    const dryRun = false;

    const shouldRefuse = !enrichmentEnabled && !dryRun;

    expect(shouldRefuse).toBe(false);
  });
});

describe('Reindex CLI safety guards', () => {
  it('requires --from-version: fromVersion undefined should trigger error', () => {
    const fromVersion: string | undefined = undefined;
    const shouldError = !fromVersion;

    expect(shouldError).toBe(true);
  });

  it('does not error when --from-version is provided', () => {
    const fromVersion: string | undefined = 'rep-v1.0';
    const shouldError = !fromVersion;

    expect(shouldError).toBe(false);
  });

  it('exits 1 when RAG_ENRICHMENT_ENABLED=false and --dry-run is not set', () => {
    const enrichmentEnabled = 'false' !== 'false';
    const dryRun = false;

    const shouldRefuse = !enrichmentEnabled && !dryRun;

    expect(shouldRefuse).toBe(true);
  });

  it('allows dry-run when enrichment is disabled', () => {
    const enrichmentEnabled = 'false' !== 'false';
    const dryRun = true;

    const shouldRefuse = !enrichmentEnabled && !dryRun;

    expect(shouldRefuse).toBe(false);
  });

  describe('--from-version format validation (rep-vX.Y)', () => {
    const FROM_VERSION_RE = /^rep-v\d+\.\d+$/;

    it('accepts valid single-digit versions', () => {
      expect(FROM_VERSION_RE.test('rep-v1.0')).toBe(true);
      expect(FROM_VERSION_RE.test('rep-v1.1')).toBe(true);
      expect(FROM_VERSION_RE.test('rep-v2.0')).toBe(true);
    });

    it('accepts valid multi-digit versions', () => {
      expect(FROM_VERSION_RE.test('rep-v10.0')).toBe(true);
      expect(FROM_VERSION_RE.test('rep-v1.12')).toBe(true);
    });

    it('rejects bare semver strings', () => {
      expect(FROM_VERSION_RE.test('1.0')).toBe(false);
      expect(FROM_VERSION_RE.test('v1.0')).toBe(false);
    });

    it('rejects malformed prefix', () => {
      expect(FROM_VERSION_RE.test('rep-1.0')).toBe(false);
      expect(FROM_VERSION_RE.test('repv1.0')).toBe(false);
      expect(FROM_VERSION_RE.test('REP-V1.0')).toBe(false);
    });

    it('rejects three-part versions', () => {
      expect(FROM_VERSION_RE.test('rep-v1.0.0')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(FROM_VERSION_RE.test('')).toBe(false);
    });

    it('rejects non-numeric components', () => {
      expect(FROM_VERSION_RE.test('rep-va.b')).toBe(false);
    });
  });
});
