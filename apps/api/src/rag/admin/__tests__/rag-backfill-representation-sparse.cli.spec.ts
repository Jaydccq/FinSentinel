/**
 * rag-backfill-representation-sparse.cli.spec.ts
 *
 * Unit tests for the rag:backfill:sparse CLI. Covers:
 *   - arg parsing (defaults, --dry-run, --batch-size, --representation-type)
 *   - invalid --batch-size values are rejected
 *   - production guard logic (allow-list + env-var confirm)
 *   - dry-run counts candidates and makes zero UPDATEs
 *   - wet-run UPDATE uses buildRepresentationTsvector output (SQL shape)
 *   - idempotency: re-running after a full backfill touches 0 rows
 *
 * Mirrors the mocking style used in apps/api/src/rag/eval/__tests__/seed-fixture.cli.spec.ts
 * and apps/api/src/rag/admin/__tests__/representation-admin.service.spec.ts —
 * no live Postgres required.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isObviouslyEphemeralDb,
  parseBackfillArgs,
  guardProductionAccidents,
  backfillSparseSearchVectors,
  type BackfillRowFetcher,
  type BackfillRowUpdater,
  type RepresentationRowForBackfill,
} from '../rag-backfill-representation-sparse.cli';

// ── parseBackfillArgs ─────────────────────────────────────────────────────────

describe('parseBackfillArgs', () => {
  it('returns sensible defaults when argv is empty', () => {
    const args = parseBackfillArgs([]);
    expect(args.dryRun).toBe(false);
    expect(args.batchSize).toBe(500);
    expect(args.representationType).toBeUndefined();
    expect(args.progressEveryBatches).toBe(1);
  });

  it('--dry-run flips dryRun on', () => {
    expect(parseBackfillArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--batch-size <N> accepts positive integers', () => {
    expect(parseBackfillArgs(['--batch-size', '1000']).batchSize).toBe(1000);
    expect(parseBackfillArgs(['--batch-size', '1']).batchSize).toBe(1);
  });

  it('--batch-size rejects zero / negative / NaN', () => {
    expect(() => parseBackfillArgs(['--batch-size', '0'])).toThrow(/batch-size/);
    expect(() => parseBackfillArgs(['--batch-size', '-5'])).toThrow(/batch-size/);
    expect(() => parseBackfillArgs(['--batch-size', 'abc'])).toThrow(/batch-size/);
  });

  it('--representation-type <type> accepts the four known types', () => {
    expect(parseBackfillArgs(['--representation-type', 'contextual_text']).representationType)
      .toBe('contextual_text');
    expect(parseBackfillArgs(['--representation-type', 'sample_question']).representationType)
      .toBe('sample_question');
    expect(parseBackfillArgs(['--representation-type', 'summary']).representationType)
      .toBe('summary');
    expect(parseBackfillArgs(['--representation-type', 'keyword_entity']).representationType)
      .toBe('keyword_entity');
  });

  it('--representation-type rejects unknown types', () => {
    expect(() => parseBackfillArgs(['--representation-type', 'bogus'])).toThrow(
      /representation-type/,
    );
  });

  it('rejects unknown flags', () => {
    expect(() => parseBackfillArgs(['--where', "x='y'"])).toThrow(/--where|unrecognized/);
    expect(() => parseBackfillArgs(['--bogus'])).toThrow(/unrecognized|--bogus/);
  });
});

// ── Production guard ──────────────────────────────────────────────────────────

describe('isObviouslyEphemeralDb', () => {
  it('accepts localhost + 127.0.0.1', () => {
    expect(isObviouslyEphemeralDb('postgresql://user:pw@localhost:5432/finsentinel')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://user:pw@127.0.0.1:5432/finsentinel')).toBe(true);
  });

  it('accepts the well-known test DB names', () => {
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_test')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_ci')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_ephemeral')).toBe(true);
  });

  it('rejects unknown host + unknown DB name', () => {
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel')).toBe(false);
  });
});

describe('guardProductionAccidents', () => {
  it('returns OK when DATABASE_URL looks ephemeral', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@localhost:5432/finsentinel',
        nodeEnv: 'development',
        sparseBackfillConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when NODE_ENV=test', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'test',
        sparseBackfillConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when SPARSE_BACKFILL_CONFIRM=1', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        sparseBackfillConfirm: '1',
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when FIXTURE_SEED_CONFIRM=1 (for parity with seed-fixture allow-list)', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        sparseBackfillConfirm: undefined,
        fixtureSeedConfirm: '1',
      }),
    ).not.toThrow();
  });

  it('throws on non-ephemeral DB without any confirm env var', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        sparseBackfillConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).toThrow(/Refusing to backfill|non-ephemeral/);
  });
});

// ── backfillSparseSearchVectors (core loop) ───────────────────────────────────

function makeRow(
  id: string,
  type: RepresentationRowForBackfill['representationType'],
  overrides: Partial<RepresentationRowForBackfill> = {},
): RepresentationRowForBackfill {
  return {
    id,
    representationType: type,
    representationContent: `rep-content-${id}`,
    chunkTitle: 'Test Title',
    chunkSectionPath: 'Results > Revenue',
    chunkContent: `chunk body for ${id}`,
    ...overrides,
  };
}

describe('backfillSparseSearchVectors', () => {
  it('dry-run counts candidates and performs ZERO UPDATEs', async () => {
    const rows = [
      makeRow('r1', 'contextual_text'),
      makeRow('r2', 'summary'),
      makeRow('r3', 'keyword_entity'),
    ];
    // Fetcher yields all rows on the first call, then empty (end-of-stream).
    const fetcher: BackfillRowFetcher = vi
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValue([]);
    const updater: BackfillRowUpdater = vi.fn().mockResolvedValue(undefined);

    const summary = await backfillSparseSearchVectors({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 500,
      dryRun: true,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.candidatesScanned).toBe(3);
    expect(summary.rowsUpdated).toBe(0);
    expect(summary.batchesProcessed).toBe(1);
    expect(updater).not.toHaveBeenCalled();
  });

  it('wet-run updates every null row once, idempotency == 0 on the second pass', async () => {
    const rows = [
      makeRow('r1', 'contextual_text'),
      makeRow('r2', 'sample_question'),
    ];

    const fetcher: BackfillRowFetcher = vi
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValue([]);
    const updater: BackfillRowUpdater = vi.fn().mockResolvedValue(undefined);

    const first = await backfillSparseSearchVectors({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 500,
      dryRun: false,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(first.candidatesScanned).toBe(2);
    expect(first.rowsUpdated).toBe(2);
    expect(updater).toHaveBeenCalledTimes(2);

    // Second pass: after fill, fetcher returns no candidate rows.
    const fetcher2: BackfillRowFetcher = vi.fn().mockResolvedValue([]);
    const updater2: BackfillRowUpdater = vi.fn().mockResolvedValue(undefined);
    const second = await backfillSparseSearchVectors({
      fetchBatch: fetcher2,
      updateRow: updater2,
      batchSize: 500,
      dryRun: false,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(second.candidatesScanned).toBe(0);
    expect(second.rowsUpdated).toBe(0);
    expect(updater2).not.toHaveBeenCalled();
  });

  it('honours batch-size boundary — 1200 rows at batch 500 yields 3 batches', async () => {
    const total = 1200;
    const all = Array.from({ length: total }, (_, i) =>
      makeRow(`r${i}`, 'contextual_text'),
    );
    // Fetcher returns up to batchSize rows per call until drained.
    let cursor = 0;
    const fetcher: BackfillRowFetcher = vi.fn().mockImplementation(async (limit: number) => {
      const slice = all.slice(cursor, cursor + limit);
      cursor += slice.length;
      return slice;
    });
    const updater: BackfillRowUpdater = vi.fn().mockResolvedValue(undefined);

    const summary = await backfillSparseSearchVectors({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 500,
      dryRun: false,
      progressEveryBatches: 10,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.candidatesScanned).toBe(total);
    expect(summary.rowsUpdated).toBe(total);
    expect(summary.batchesProcessed).toBe(3); // 500, 500, 200
    expect(updater).toHaveBeenCalledTimes(total);
  });

  it('passes a Drizzle SQL fragment to updateRow built via buildRepresentationTsvector', async () => {
    // We cannot stringify the fragment deterministically, but we can assert
    // that `updateRow` is called with (id, <sql-like-object>) and that the
    // SQL-like object has the Drizzle `queryChunks` (or `chunks`) shape. The
    // helper `buildRepresentationTsvector` is the only producer of such
    // fragments in this CLI, so shape-matching proves usage.
    const fetcher: BackfillRowFetcher = vi
      .fn()
      .mockResolvedValueOnce([makeRow('r1', 'contextual_text')])
      .mockResolvedValue([]);
    const updater: BackfillRowUpdater = vi.fn().mockResolvedValue(undefined);

    await backfillSparseSearchVectors({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 10,
      dryRun: false,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(updater).toHaveBeenCalledOnce();
    const [rowId, fragment] = updater.mock.calls[0]!;
    expect(rowId).toBe('r1');
    // Drizzle SQL fragments carry `queryChunks` (internal field). Either that
    // or `chunks` on older releases. If the updater was handed a plain string,
    // the cli would have inlined user content into SQL — that would be a bug.
    const frag = fragment as { queryChunks?: unknown[]; chunks?: unknown[] };
    const chunks = frag.queryChunks ?? frag.chunks;
    expect(Array.isArray(chunks)).toBe(true);
    expect((chunks as unknown[]).length).toBeGreaterThan(0);
  });
});

