/**
 * rag-backfill-chunk-issuer-tickers.cli.spec.ts
 *
 * Unit tests for the rag:backfill:chunk-issuer-tickers CLI. Covers:
 *   - arg parsing (defaults, --dry-run, --batch-size, --force, --progress-every)
 *   - invalid --batch-size values are rejected
 *   - unknown flags are rejected
 *   - production guard logic (allow-list + env-var confirm)
 *   - dry-run counts candidates and makes zero UPDATEs
 *   - wet-run calls updateRow for every row
 *   - empty-result chunk (tickers=[]) still writes tickers key (idempotency)
 *   - extractable row writes both tickers and issuerName
 *
 * No live Postgres required — all DB interaction is replaced by typed stubs.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isObviouslyEphemeralDb,
  parseArgs,
  guardProductionAccidents,
  backfillChunkIssuerTickers,
  type BackfillCliArgs,
  type ChunkRowForBackfill,
  type ChunkRowFetcher,
  type ChunkRowUpdater,
} from '../rag-backfill-chunk-issuer-tickers.cli';

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('returns sensible defaults when argv is empty', () => {
    const args = parseArgs([]);
    expect(args.dryRun).toBe(false);
    expect(args.batchSize).toBe(500);
    expect(args.progressEveryBatches).toBe(1);
    expect(args.force).toBe(false);
  });

  it('--dry-run flips dryRun on', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--batch-size <N> accepts positive integers', () => {
    expect(parseArgs(['--batch-size', '100']).batchSize).toBe(100);
    expect(parseArgs(['--batch-size', '1']).batchSize).toBe(1);
  });

  it('--batch-size rejects zero / negative / NaN', () => {
    expect(() => parseArgs(['--batch-size', '0'])).toThrow(/batch-size/);
    expect(() => parseArgs(['--batch-size', '-5'])).toThrow(/batch-size/);
    expect(() => parseArgs(['--batch-size', 'abc'])).toThrow(/batch-size/);
  });

  it('--force flips force on', () => {
    expect(parseArgs(['--force']).force).toBe(true);
  });

  it('--progress-every <N> accepts positive integers', () => {
    expect(parseArgs(['--progress-every', '10']).progressEveryBatches).toBe(10);
  });

  it('--progress-every rejects zero / NaN', () => {
    expect(() => parseArgs(['--progress-every', '0'])).toThrow(/progress-every/);
    expect(() => parseArgs(['--progress-every', 'xyz'])).toThrow(/progress-every/);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--where', "x='y'"])).toThrow(/unrecognized|--where/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unrecognized|--bogus/);
  });

  it('rejects unrecognized positional arguments', () => {
    expect(() => parseArgs(['somearg'])).toThrow(/unrecognized/);
  });
});

// ── Production guard ──────────────────────────────────────────────────────────

describe('isObviouslyEphemeralDb', () => {
  it('accepts localhost + 127.0.0.1', () => {
    expect(isObviouslyEphemeralDb('postgresql://user:pw@localhost:5432/finsentinel')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://user:pw@127.0.0.1:5432/finsentinel')).toBe(true);
  });

  it('accepts the postgres Docker service hostname', () => {
    expect(isObviouslyEphemeralDb('postgresql://u:p@postgres/finsentinel')).toBe(true);
  });

  it('accepts the well-known test DB names', () => {
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_test')).toBe(true);
    expect(isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_ci')).toBe(true);
    expect(
      isObviouslyEphemeralDb('postgresql://u:p@prod.example.com/finsentinel_ephemeral'),
    ).toBe(true);
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
        chunkTickersBackfillConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when NODE_ENV=test', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'test',
        chunkTickersBackfillConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when CHUNK_TICKERS_BACKFILL_CONFIRM=1', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        chunkTickersBackfillConfirm: '1',
        fixtureSeedConfirm: undefined,
      }),
    ).not.toThrow();
  });

  it('returns OK when FIXTURE_SEED_CONFIRM=1 (parity with seed-fixture allow-list)', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        chunkTickersBackfillConfirm: undefined,
        fixtureSeedConfirm: '1',
      }),
    ).not.toThrow();
  });

  it('throws on non-ephemeral DB without any confirm env var', () => {
    expect(() =>
      guardProductionAccidents({
        databaseUrl: 'postgresql://u:p@prod.example.com/finsentinel',
        nodeEnv: 'production',
        chunkTickersBackfillConfirm: undefined,
        fixtureSeedConfirm: undefined,
      }),
    ).toThrow(/Refusing to backfill|non-ephemeral/);
  });
});

// ── backfillChunkIssuerTickers (core loop) ────────────────────────────────────

function makeRow(
  id: string,
  overrides: Partial<ChunkRowForBackfill> = {},
): ChunkRowForBackfill {
  return {
    id,
    content: `This is the content for chunk ${id}.`,
    metadata: {},
    originalFileName: null,
    docTitle: null,
    ...overrides,
  };
}

describe('backfillChunkIssuerTickers', () => {
  it('wet-run: 2 batches of 2 rows → updateRow called 4 times', async () => {
    const batch1 = [makeRow('c1'), makeRow('c2')];
    const batch2 = [makeRow('c3'), makeRow('c4')];

    const fetcher: ChunkRowFetcher = vi
      .fn()
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValue([]);

    const updater: ChunkRowUpdater = vi.fn().mockResolvedValue(undefined);

    const summary = await backfillChunkIssuerTickers({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 2,
      dryRun: false,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.candidatesScanned).toBe(4);
    expect(summary.rowsUpdated).toBe(4);
    expect(summary.batchesProcessed).toBe(2);
    expect(updater).toHaveBeenCalledTimes(4);
  });

  it('dry-run: 2 batches of 2 rows → updateRow called 0 times, candidatesScanned = 4', async () => {
    const batch1 = [makeRow('c1'), makeRow('c2')];
    const batch2 = [makeRow('c3'), makeRow('c4')];

    const fetcher: ChunkRowFetcher = vi
      .fn()
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValue([]);

    const updater: ChunkRowUpdater = vi.fn().mockResolvedValue(undefined);

    const summary = await backfillChunkIssuerTickers({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 2,
      dryRun: true,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.candidatesScanned).toBe(4);
    expect(summary.rowsUpdated).toBe(0);
    expect(summary.batchesProcessed).toBe(2);
    expect(updater).not.toHaveBeenCalled();
  });

  it('empty-result chunk: extractor finds nothing → updater still writes tickers:[] and NO issuerName', async () => {
    // A row with purely lower-case content — no ticker tokens will match.
    const row = makeRow('c1', {
      content: 'this chunk has no recognised ticker symbols or issuer names at all.',
      originalFileName: null,
      docTitle: null,
    });

    const fetcher: ChunkRowFetcher = vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValue([]);

    const capturedUpdates: Array<{ id: string; newFields: Record<string, unknown> }> = [];
    const updater: ChunkRowUpdater = vi.fn().mockImplementation(
      async (id: string, newFields: Record<string, unknown>) => {
        capturedUpdates.push({ id, newFields });
      },
    );

    await backfillChunkIssuerTickers({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 500,
      dryRun: false,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(updater).toHaveBeenCalledOnce();
    const update = capturedUpdates[0]!;
    expect(update.id).toBe('c1');
    // tickers key MUST be present (enables idempotency filter on re-run)
    expect(update.newFields).toHaveProperty('tickers');
    expect(update.newFields['tickers']).toEqual([]);
    // issuerName must NOT be written when nothing was found
    expect(update.newFields).not.toHaveProperty('issuerName');
  });

  it('extractable row: updater receives both tickers and issuerName', async () => {
    // Use a known ticker and an issuer-name pattern that satisfies ISSUER_REGEX.
    const row = makeRow('c2', {
      content: 'Apple Inc. reported strong Q3 earnings. AAPL stock rose 5%.',
      originalFileName: 'AAPL_10K_2024.pdf',
      docTitle: 'Apple Inc. Annual Report 2024',
    });

    const fetcher: ChunkRowFetcher = vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValue([]);

    const capturedUpdates: Array<{ id: string; newFields: Record<string, unknown> }> = [];
    const updater: ChunkRowUpdater = vi.fn().mockImplementation(
      async (id: string, newFields: Record<string, unknown>) => {
        capturedUpdates.push({ id, newFields });
      },
    );

    await backfillChunkIssuerTickers({
      fetchBatch: fetcher,
      updateRow: updater,
      batchSize: 500,
      dryRun: false,
      progressEveryBatches: 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(updater).toHaveBeenCalledOnce();
    const update = capturedUpdates[0]!;
    expect(update.id).toBe('c2');
    expect(update.newFields).toHaveProperty('tickers');
    expect(Array.isArray(update.newFields['tickers'])).toBe(true);
    expect((update.newFields['tickers'] as string[]).includes('AAPL')).toBe(true);
    expect(update.newFields).toHaveProperty('issuerName');
    expect(typeof update.newFields['issuerName']).toBe('string');
  });
});
