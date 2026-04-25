/**
 * rag-reindex-by-doctype.cli.spec.ts
 *
 * Unit tests for the rag:reindex:by-doctype CLI. Covers:
 *   - parseReindexArgs: defaults, --dry-run, --batch, --force, --max-wait-seconds
 *   - invalid integer flags are rejected
 *   - unknown flags are rejected
 *   - guardProductionAccidents: allow-list + env-var confirm (REINDEX_BY_DOCTYPE_CONFIRM)
 *   - Core loop (reindexByDocType):
 *     - wet-run 2 batches of 2 docs → reindexer called 4×, drainWait called 2×
 *     - dry-run → reindexer called 0×, fetcher still advances
 *     - idempotency: fetcher returns docs with matching chunker_version → skipped
 *
 * No live DB, Redis, or BullMQ required.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseReindexArgs,
  isObviouslyEphemeralDb,
  guardProductionAccidents,
  reindexByDocType,
  CHUNKER_VERSION,
  type ReindexCliArgs,
  type DocRowForReindex,
  type DocRowFetcher,
  type DocReindexer,
  type DrainWaiter,
  type ReindexProgressLogger,
} from '../rag-reindex-by-doctype.cli';

// ── parseReindexArgs ───────────────────────────────────────────────────────────

describe('parseReindexArgs', () => {
  it('returns sensible defaults when argv is empty', () => {
    const args = parseReindexArgs([]);
    expect(args.dryRun).toBe(false);
    expect(args.batch).toBe(25);
    expect(args.force).toBe(false);
    expect(args.maxWaitSeconds).toBe(1800);
  });

  it('--dry-run flips dryRun on', () => {
    expect(parseReindexArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--batch <N> accepts positive integers', () => {
    expect(parseReindexArgs(['--batch', '50']).batch).toBe(50);
    expect(parseReindexArgs(['--batch', '1']).batch).toBe(1);
  });

  it('--batch rejects zero / negative / NaN', () => {
    expect(() => parseReindexArgs(['--batch', '0'])).toThrow(/batch/);
    expect(() => parseReindexArgs(['--batch', '-5'])).toThrow(/batch/);
    expect(() => parseReindexArgs(['--batch', 'abc'])).toThrow(/batch/);
  });

  it('--force flips force on', () => {
    expect(parseReindexArgs(['--force']).force).toBe(true);
  });

  it('--max-wait-seconds <N> accepts positive integers', () => {
    expect(parseReindexArgs(['--max-wait-seconds', '120']).maxWaitSeconds).toBe(120);
  });

  it('--max-wait-seconds rejects zero / NaN', () => {
    expect(() => parseReindexArgs(['--max-wait-seconds', '0'])).toThrow(/max-wait-seconds/);
    expect(() => parseReindexArgs(['--max-wait-seconds', 'xyz'])).toThrow(/max-wait-seconds/);
  });

  it('rejects unknown flags', () => {
    expect(() => parseReindexArgs(['--where', "x='y'"])).toThrow(/unrecognized|--where/);
    expect(() => parseReindexArgs(['--bogus'])).toThrow(/unrecognized|--bogus/);
  });

  it('rejects unrecognized positional arguments', () => {
    expect(() => parseReindexArgs(['somearg'])).toThrow(/unrecognized/);
  });
});

// ── Production guard ───────────────────────────────────────────────────────────

describe('isObviouslyEphemeralDb', () => {
  it('accepts localhost + 127.0.0.1', () => {
    expect(isObviouslyEphemeralDb('postgresql://user:pw@localhost:5432/finsentinel')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://user:pw@127.0.0.1:5432/finsentinel')).toBe(true);
  });

  it('accepts the postgres Docker service hostname', () => {
    expect(isObviouslyEphemeralDb('postgresql://u:p@postgres/finsentinel')).toBe(true);
  });

  it('accepts well-known test DB names', () => {
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_test')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_ci')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_ephemeral')).toBe(
      true,
    );
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
        reindexByDoctypeConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when NODE_ENV=test', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'test',
        reindexByDoctypeConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when REINDEX_BY_DOCTYPE_CONFIRM=1', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        reindexByDoctypeConfirm: '1',
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when FIXTURE_SEED_CONFIRM=1 (parity with seed-fixture allow-list)', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        reindexByDoctypeConfirm: undefined,
        fixtureSeedConfirm: '1',
      }),
    ).not.toThrow();
  });

  it('throws on non-ephemeral DB without any confirm env var', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        reindexByDoctypeConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).toThrow(/Refusing to reindex|non-ephemeral/);
  });
});

// ── reindexByDocType (core loop) ───────────────────────────────────────────────

function makeDocRow(id: string, overrides: Partial<DocRowForReindex> = {}): DocRowForReindex {
  return {
    id,
    storageKey: `docs/${id}.txt`,
    docType: 'REPORT',
    sector: 'TECH',
    originalFileName: `doc-${id}.txt`,
    meta: null,
    ...overrides,
  };
}

describe('reindexByDocType', () => {
  it('wet-run: 2 batches of 2 docs each → reindexer called 4×, drainWait called 2× (once per batch)', async () => {
    const batch1 = [makeDocRow('d1'), makeDocRow('d2')];
    const batch2 = [makeDocRow('d3'), makeDocRow('d4')];

    const fetcher: DocRowFetcher = vi
      .fn()
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValue([]);

    const reindexer: DocReindexer = vi.fn().mockResolvedValue(undefined);
    const drainWait: DrainWaiter = vi.fn().mockResolvedValue(undefined);

    const logger: ReindexProgressLogger = { info: vi.fn(), warn: vi.fn() };

    const summary = await reindexByDocType({
      fetchBatch: fetcher,
      reindexDoc: reindexer,
      drainWait,
      batchSize: 2,
      dryRun: false,
      maxWaitSeconds: 60,
      logger,
    });

    expect(summary.docsScanned).toBe(4);
    expect(summary.docsReindexed).toBe(4);
    expect(summary.batchesProcessed).toBe(2);
    expect(reindexer).toHaveBeenCalledTimes(4);
    // drainWait is called once per batch (after each batch is processed)
    expect(drainWait).toHaveBeenCalledTimes(2);
  });

  it('dry-run: fetcher advances, reindexer called 0×, drainWait NOT called', async () => {
    const batch1 = [makeDocRow('d1'), makeDocRow('d2')];
    const batch2 = [makeDocRow('d3'), makeDocRow('d4')];

    const fetcher: DocRowFetcher = vi
      .fn()
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValue([]);

    const reindexer: DocReindexer = vi.fn().mockResolvedValue(undefined);
    const drainWait: DrainWaiter = vi.fn().mockResolvedValue(undefined);

    const logger: ReindexProgressLogger = { info: vi.fn(), warn: vi.fn() };

    const summary = await reindexByDocType({
      fetchBatch: fetcher,
      reindexDoc: reindexer,
      drainWait,
      batchSize: 2,
      dryRun: true,
      maxWaitSeconds: 60,
      logger,
    });

    expect(summary.docsScanned).toBe(4);
    expect(summary.docsReindexed).toBe(0);
    expect(summary.batchesProcessed).toBe(2);
    expect(reindexer).not.toHaveBeenCalled();
    expect(drainWait).not.toHaveBeenCalled();
  });

  it('idempotency: rows with matching chunker_version are skipped even when fetcher returns them', async () => {
    // Simulate --force=false: the SQL already filters these out, but the in-code guard
    // also checks and skips to avoid double-processing if the fetcher somehow returns them.
    // The CLI-level guard: when !force, skip any row whose meta->chunker_version === CHUNKER_VERSION.
    const alreadyIndexed = makeDocRow('d1', {
      meta: { chunker_version: CHUNKER_VERSION },
    });
    const needsIndex = makeDocRow('d2');

    const fetcher: DocRowFetcher = vi
      .fn()
      .mockResolvedValueOnce([alreadyIndexed, needsIndex])
      .mockResolvedValue([]);

    const reindexer: DocReindexer = vi.fn().mockResolvedValue(undefined);
    const drainWait: DrainWaiter = vi.fn().mockResolvedValue(undefined);

    const summary = await reindexByDocType({
      fetchBatch: fetcher,
      reindexDoc: reindexer,
      drainWait,
      batchSize: 25,
      dryRun: false,
      maxWaitSeconds: 60,
      logger: { info: vi.fn(), warn: vi.fn() },
      force: false,
    });

    // d1 is skipped (already at CHUNKER_VERSION), d2 is reindexed
    expect(summary.docsScanned).toBe(2);
    expect(summary.docsReindexed).toBe(1);
    expect(reindexer).toHaveBeenCalledTimes(1);
    // drainWait is called once (the batch had 1 actual reindex)
    expect(drainWait).toHaveBeenCalledTimes(1);
  });

  it('force=true: rows with matching chunker_version are NOT skipped', async () => {
    const alreadyIndexed = makeDocRow('d1', {
      meta: { chunker_version: CHUNKER_VERSION },
    });

    const fetcher: DocRowFetcher = vi
      .fn()
      .mockResolvedValueOnce([alreadyIndexed])
      .mockResolvedValue([]);

    const reindexer: DocReindexer = vi.fn().mockResolvedValue(undefined);
    const drainWait: DrainWaiter = vi.fn().mockResolvedValue(undefined);

    const summary = await reindexByDocType({
      fetchBatch: fetcher,
      reindexDoc: reindexer,
      drainWait,
      batchSize: 25,
      dryRun: false,
      maxWaitSeconds: 60,
      logger: { info: vi.fn(), warn: vi.fn() },
      force: true,
    });

    expect(summary.docsReindexed).toBe(1);
    expect(reindexer).toHaveBeenCalledTimes(1);
  });

  it('empty first fetch → zero work, drainWait never called', async () => {
    const fetcher: DocRowFetcher = vi.fn().mockResolvedValue([]);
    const reindexer: DocReindexer = vi.fn().mockResolvedValue(undefined);
    const drainWait: DrainWaiter = vi.fn().mockResolvedValue(undefined);

    const summary = await reindexByDocType({
      fetchBatch: fetcher,
      reindexDoc: reindexer,
      drainWait,
      batchSize: 25,
      dryRun: false,
      maxWaitSeconds: 60,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.docsScanned).toBe(0);
    expect(summary.docsReindexed).toBe(0);
    expect(summary.batchesProcessed).toBe(0);
    expect(drainWait).not.toHaveBeenCalled();
  });

  it('reindexer is called with the correct doc row', async () => {
    const docRow = makeDocRow('abc-123', {
      docType: 'QA',
      sector: 'FINANCE',
      originalFileName: 'my-doc.md',
    });

    const fetcher: DocRowFetcher = vi.fn().mockResolvedValueOnce([docRow]).mockResolvedValue([]);

    const capturedCalls: DocRowForReindex[] = [];
    const reindexer: DocReindexer = vi.fn().mockImplementation(async (row: DocRowForReindex) => {
      capturedCalls.push(row);
    });
    const drainWait: DrainWaiter = vi.fn().mockResolvedValue(undefined);

    await reindexByDocType({
      fetchBatch: fetcher,
      reindexDoc: reindexer,
      drainWait,
      batchSize: 25,
      dryRun: false,
      maxWaitSeconds: 60,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]!.id).toBe('abc-123');
    expect(capturedCalls[0]!.docType).toBe('QA');
  });
});
