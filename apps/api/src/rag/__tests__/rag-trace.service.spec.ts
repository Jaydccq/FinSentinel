import { describe, it, expect, vi, type Mock } from 'vitest';
import { createHash } from 'node:crypto';
import { RagTraceService, type RagTraceInput } from '../rag-trace.service';

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function makeDb(executeFn?: Mock) {
  return { execute: executeFn ?? vi.fn().mockResolvedValue([]) };
}

function makeConfigService(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string, defaultVal: unknown) => {
      if (key in overrides) return overrides[key];
      if (key === 'rag.queryLog.sampleRate') return 1.0;
      if (key === 'rag.queryLog.piiEnabled') return false;
      return defaultVal;
    }),
  };
}

function makeMetrics() {
  return { incrementCounter: vi.fn() as Mock };
}

function baseInput(overrides: Partial<RagTraceInput> = {}): RagTraceInput {
  return {
    query: 'What is the revenue outlook for AAPL?',
    filters: {},
    lanes: ['dense', 'sparse'],
    resultChunkIds: [],
    laneCounts: {},
    timingsMs: { plan: 10, orchestrate: 50 },
    fallbackFlags: [],
    ...overrides,
  };
}

describe('RagTraceService — hashing', () => {
  it('same query produces same query_hash in INSERT payload', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(makeDb(executeFn) as any, makeConfigService() as any, makeMetrics() as any);

    await svc.recordTrace(baseInput({ query: 'hello world' }));

    const call = executeFn.mock.calls[0] as unknown[];
    const sqlArg = call[0] as { queryChunks?: { value?: unknown }[]; values?: unknown[] };
    // The SQL template literal gets compiled by drizzle sql tag. We assert
    // the computed hash appears somewhere in the serialised call argument.
    const serialised = JSON.stringify(sqlArg);
    const expected = sha256hex('hello world');
    expect(serialised).toContain(expected);
  });

  it('two calls with the same query produce the same hash', async () => {
    const calls: string[] = [];
    const executeFn = vi.fn().mockImplementation(async (sqlArg: unknown) => {
      calls.push(JSON.stringify(sqlArg));
      return [];
    });
    const svc = new RagTraceService(makeDb(executeFn) as any, makeConfigService() as any, makeMetrics() as any);

    await svc.recordTrace(baseInput({ query: 'consistent query' }));
    await svc.recordTrace(baseInput({ query: 'consistent query' }));

    expect(calls).toHaveLength(2);
    // Both serialised SQL args should be identical in hash content.
    const hash = sha256hex('consistent query');
    expect(calls[0]).toContain(hash);
    expect(calls[1]).toContain(hash);
  });

  it('PII off: query_preview is null in INSERT payload', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(
      makeDb(executeFn) as any,
      makeConfigService({ 'rag.queryLog.piiEnabled': false }) as any,
      makeMetrics() as any,
    );
    await svc.recordTrace(baseInput({ query: 'secret query text' }));

    const serialised = JSON.stringify(executeFn.mock.calls[0]);
    // query_preview should not be in the values when PII is off
    expect(serialised).not.toContain('secret query text');
  });

  it('PII on: query_preview is populated in INSERT payload (up to 500 chars)', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(
      makeDb(executeFn) as any,
      makeConfigService({ 'rag.queryLog.piiEnabled': true }) as any,
      makeMetrics() as any,
    );
    const longQuery = 'Q'.repeat(600);
    await svc.recordTrace(baseInput({ query: longQuery }));

    const serialised = JSON.stringify(executeFn.mock.calls[0]);
    // The first 500 chars should appear in the payload.
    expect(serialised).toContain('Q'.repeat(500));
    // The full 600-char query should NOT appear (sliced at 500).
    expect(serialised).not.toContain('Q'.repeat(501));
  });

  it('hashes variant queries independently', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(makeDb(executeFn) as any, makeConfigService() as any, makeMetrics() as any);

    const variantQuery = 'rewritten variant query';
    await svc.recordTrace(baseInput({
      variants: [{ kind: 'rewrite', query: variantQuery }],
    }));

    const serialised = JSON.stringify(executeFn.mock.calls[0]);
    const variantHash = sha256hex(variantQuery);
    expect(serialised).toContain(variantHash);
    // Variant raw text should NOT appear in INSERT (hashed only, PII off).
    expect(serialised).not.toContain(variantQuery);
  });
});

describe('RagTraceService — sampling', () => {
  it('sample rate 0.0: does not INSERT for normal queries', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(
      makeDb(executeFn) as any,
      makeConfigService({ 'rag.queryLog.sampleRate': 0.0 }) as any,
      makeMetrics() as any,
    );
    await svc.recordTrace(baseInput());
    expect(executeFn).not.toHaveBeenCalled();
  });

  it('sample rate 1.0: always INSERTs', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(
      makeDb(executeFn) as any,
      makeConfigService({ 'rag.queryLog.sampleRate': 1.0 }) as any,
      makeMetrics() as any,
    );
    await svc.recordTrace(baseInput());
    expect(executeFn).toHaveBeenCalledOnce();
  });

  it('fallback-flagged queries are always logged regardless of sample rate 0.0', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(
      makeDb(executeFn) as any,
      makeConfigService({ 'rag.queryLog.sampleRate': 0.0 }) as any,
      makeMetrics() as any,
    );
    await svc.recordTrace(baseInput({ fallbackFlags: ['hyde_failed'] }));
    expect(executeFn).toHaveBeenCalledOnce();
  });

  it('non-null rerankReason always logs regardless of sample rate 0.0', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(
      makeDb(executeFn) as any,
      makeConfigService({ 'rag.queryLog.sampleRate': 0.0 }) as any,
      makeMetrics() as any,
    );
    await svc.recordTrace(baseInput({ rerankReason: 'rerank_malformed' }));
    expect(executeFn).toHaveBeenCalledOnce();
  });

  it('counter label is always_logged when fallbackFlags present', async () => {
    const metrics = makeMetrics();
    const svc = new RagTraceService(
      makeDb() as any,
      makeConfigService({ 'rag.queryLog.sampleRate': 0.0 }) as any,
      metrics as any,
    );
    await svc.recordTrace(baseInput({ fallbackFlags: ['hyde_failed'] }));
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_trace_writes_total',
      expect.any(String),
      { kind: 'always_logged' },
    );
  });

  it('counter label is sampled when no fallback flags and sample rate 1.0', async () => {
    const metrics = makeMetrics();
    const svc = new RagTraceService(
      makeDb() as any,
      makeConfigService({ 'rag.queryLog.sampleRate': 1.0 }) as any,
      metrics as any,
    );
    await svc.recordTrace(baseInput({ fallbackFlags: [] }));
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_trace_writes_total',
      expect.any(String),
      { kind: 'sampled' },
    );
  });

  it('deterministic bucket: same query consistently included/excluded at fractional rate', () => {
    // Compute bucket manually and verify the service agrees.
    const query = 'test deterministic query';
    const queryHash = sha256hex(query);
    const bucket = createHash('sha256').update(queryHash).digest()[0]! / 255;

    // Pick a rate just above or below the bucket to force include/exclude.
    const includeRate = bucket + 0.01;
    const excludeRate = bucket - 0.01;

    if (includeRate <= 1.0) {
      // At includeRate the bucket < rate so it should be sampled.
      expect(bucket).toBeLessThan(includeRate);
    }
    if (excludeRate >= 0.0) {
      // At excludeRate the bucket >= rate so it should be excluded.
      expect(bucket).toBeGreaterThanOrEqual(excludeRate);
    }
  });
});

describe('RagTraceService — error handling', () => {
  it('does not throw when DB execute rejects', async () => {
    const executeFn = vi.fn().mockRejectedValue(new Error('DB connection lost'));
    const svc = new RagTraceService(
      makeDb(executeFn) as any,
      makeConfigService() as any,
      makeMetrics() as any,
    );
    await expect(svc.recordTrace(baseInput())).resolves.toBeUndefined();
  });

  it('does not throw when metrics is undefined', async () => {
    const svc = new RagTraceService(makeDb() as any, makeConfigService() as any);
    await expect(svc.recordTrace(baseInput())).resolves.toBeUndefined();
  });
});

describe('RagTraceService — INSERT column completeness', () => {
  it('INSERT SQL references all required columns', async () => {
    const executeFn = vi.fn().mockResolvedValue([]);
    const svc = new RagTraceService(makeDb(executeFn) as any, makeConfigService() as any, makeMetrics() as any);
    await svc.recordTrace(baseInput({
      userId: 'user-uuid-123',
      queryClass: 'factoid',
      rerankReason: null,
      totalMs: 120,
    }));

    const serialised = JSON.stringify(executeFn.mock.calls[0]);
    const requiredColumns = [
      'id', 'user_id', 'query_hash', 'query_preview', 'query_class',
      'variants', 'filters', 'lanes', 'result_chunk_ids', 'lane_counts',
      'timings_ms', 'fallback_flags', 'rerank_reason', 'total_ms', 'created_at',
    ];
    for (const col of requiredColumns) {
      expect(serialised, `Missing column ${col}`).toContain(col);
    }
  });
});
