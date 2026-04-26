import { describe, it, expect, vi } from 'vitest';
import {
  parsePromoteArgs,
  runPromotePipeline,
  type PromotePipelineDeps,
} from '../rag-promote-eval.cli';
import type { GoldenSetFile, QueryLogRow } from '../rag-promote-eval.service';

function makeDeps(overrides: Partial<PromotePipelineDeps>): PromotePipelineDeps {
  const golden: GoldenSetFile = { version: '2.1', entries: [] };
  return {
    fetchLogs: async () => [],
    readGolden: async () => golden,
    readMeta: async () => ({ version: '2.1' }),
    writeGolden: vi.fn(async () => {}),
    writeMeta: vi.fn(async () => {}),
    now: () => new Date('2026-04-25T12:00:00Z'),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

function mkLog(id: string, qclass: string, preview: string | null = `q-${id}`): QueryLogRow {
  return {
    id,
    query_preview: preview,
    query_class: qclass,
    result_chunk_ids: [`c-${id}`],
    created_at: '2026-04-22T00:00:00Z',
  };
}

describe('parsePromoteArgs', () => {
  it('parses defaults', () => {
    const args = parsePromoteArgs([], new Date('2026-04-25T00:00:00Z'));
    expect(args.perClass).toBe(10);
    expect(args.dryRun).toBe(false);
    expect(args.since).toBe('2026-03-26T00:00:00.000Z');
  });

  it('parses --per-class --since --dry-run --out', () => {
    const args = parsePromoteArgs(
      ['--per-class', '5', '--since', '2026-04-01T00:00:00Z', '--dry-run', '--out', '/tmp/x.json'],
      new Date('2026-04-25T00:00:00Z'),
    );
    expect(args.perClass).toBe(5);
    expect(args.since).toBe('2026-04-01T00:00:00Z');
    expect(args.dryRun).toBe(true);
    expect(args.outputPath).toBe('/tmp/x.json');
  });

  it('rejects invalid --per-class', () => {
    expect(() => parsePromoteArgs(['--per-class', '0'])).toThrow(/positive integer/);
    expect(() => parsePromoteArgs(['--per-class', 'abc'])).toThrow(/positive integer/);
  });

  it('rejects invalid --since', () => {
    expect(() => parsePromoteArgs(['--since', 'not-a-date'])).toThrow(/ISO timestamp/);
  });

  it('rejects unknown flags', () => {
    expect(() => parsePromoteArgs(['--unknown'])).toThrow(/unrecognized flag/);
  });

  it('derives sibling meta path when --out is explicit but --meta is not', () => {
    const args = parsePromoteArgs(['--out', '/tmp/local-promote.json']);
    expect(args.outputPath).toBe('/tmp/local-promote.json');
    // Must NOT default to the canonical meta path (which would silently mutate
    // services/evaluation-runner/datasets/golden.meta.json on a /tmp run).
    expect(args.metaPath).toBe('/tmp/local-promote.meta.json');
    expect(args.metaPath).not.toMatch(/services\/evaluation-runner/);
  });

  it('respects explicit --meta when both --out and --meta are provided', () => {
    const args = parsePromoteArgs([
      '--out',
      '/tmp/local-promote.json',
      '--meta',
      '/tmp/custom.meta.json',
    ]);
    expect(args.metaPath).toBe('/tmp/custom.meta.json');
  });

  it('keeps the canonical meta path when neither --out nor --meta is provided', () => {
    const args = parsePromoteArgs([]);
    expect(args.metaPath).toMatch(
      /services\/evaluation-runner\/datasets\/golden\.meta\.json$/,
    );
  });
});

describe('runPromotePipeline', () => {
  it('dry-run reports class balance and does not write', async () => {
    const writeGolden = vi.fn(async () => {});
    const writeMeta = vi.fn(async () => {});
    const deps = makeDeps({
      fetchLogs: async () => [
        mkLog('1', 'factoid'),
        mkLog('2', 'factoid'),
        mkLog('3', 'exact_lookup'),
      ],
      writeGolden,
      writeMeta,
    });
    const result = await runPromotePipeline(
      {
        perClass: 10,
        since: '2026-04-01T00:00:00Z',
        outputPath: '/tmp/golden.json',
        metaPath: '/tmp/golden.meta.json',
        dryRun: true,
      },
      deps,
    );
    expect(result.added).toBe(0);
    expect(result.classes).toEqual({ factoid: 2, exact_lookup: 1 });
    expect(result.total).toBe(3);
    expect(writeGolden).not.toHaveBeenCalled();
    expect(writeMeta).not.toHaveBeenCalled();
  });

  it('wet-run appends rows and skips duplicates', async () => {
    const golden: GoldenSetFile = {
      version: '2.1',
      entries: [{ id: 'gs-001', source_query_log_id: '2' }],
    };
    const writeGolden = vi.fn(async () => {});
    const writeMeta = vi.fn(async () => {});
    const deps = makeDeps({
      fetchLogs: async () => [mkLog('1', 'factoid'), mkLog('2', 'factoid')],
      readGolden: async () => golden,
      writeGolden,
      writeMeta,
    });
    const result = await runPromotePipeline(
      {
        perClass: 10,
        since: '2026-04-01T00:00:00Z',
        outputPath: '/tmp/golden.json',
        metaPath: '/tmp/golden.meta.json',
        dryRun: false,
      },
      deps,
    );
    expect(result.added).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(writeGolden).toHaveBeenCalledOnce();
    expect(writeMeta).toHaveBeenCalledOnce();
    // The golden object passed to writeGolden should now include log-1 promoted.
    const writtenGolden = (writeGolden.mock.calls[0]?.[1] as GoldenSetFile);
    expect(writtenGolden.entries).toHaveLength(2);
    expect(
      writtenGolden.entries.some((e) => e['source_query_log_id'] === '1'),
    ).toBe(true);
    // Meta should have a promotion_log entry and bumped version.
    const writtenMeta = writeMeta.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Array.isArray(writtenMeta['promotion_log'])).toBe(true);
    expect(typeof writtenMeta['version']).toBe('string');
    expect(writtenMeta['version']).toMatch(/promoted/);
  });

  it('counts rows missing query_preview and skips them in sampling', async () => {
    const writeGolden = vi.fn(async () => {});
    const deps = makeDeps({
      fetchLogs: async () => [
        mkLog('1', 'factoid', null),
        mkLog('2', 'factoid', ''),
        mkLog('3', 'factoid', 'real query'),
      ],
      writeGolden,
    });
    const result = await runPromotePipeline(
      {
        perClass: 10,
        since: '2026-04-01T00:00:00Z',
        outputPath: '/tmp/golden.json',
        metaPath: '/tmp/golden.meta.json',
        dryRun: true,
      },
      deps,
    );
    expect(result.withoutPreview).toBe(2);
    expect(result.total).toBe(1);
  });

  it('warns when all rows lack query_preview', async () => {
    const warn = vi.fn();
    const deps = makeDeps({
      fetchLogs: async () => [mkLog('1', 'factoid', null), mkLog('2', 'factoid', null)],
      logger: { info: vi.fn(), warn },
    });
    await runPromotePipeline(
      {
        perClass: 10,
        since: '2026-04-01T00:00:00Z',
        outputPath: '/tmp/golden.json',
        metaPath: '/tmp/golden.meta.json',
        dryRun: true,
      },
      deps,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/piiEnabled/));
  });

  it('warns and proceeds when there are no rag_query_logs rows', async () => {
    const warn = vi.fn();
    const deps = makeDeps({
      fetchLogs: async () => [],
      logger: { info: vi.fn(), warn },
    });
    const result = await runPromotePipeline(
      {
        perClass: 10,
        since: '2026-04-01T00:00:00Z',
        outputPath: '/tmp/golden.json',
        metaPath: '/tmp/golden.meta.json',
        dryRun: true,
      },
      deps,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no rag_query_logs/));
    expect(result.total).toBe(0);
    expect(result.classes).toEqual({});
  });
});
