import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RagTraceRetentionService } from '../rag-trace-retention.service';

function makeMetrics() {
  return { incrementCounter: vi.fn() as Mock };
}

function makeConfigService(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string, defaultVal: unknown) => {
      if (key in overrides) return overrides[key];
      if (key === 'rag.queryLog.retentionDays') return 30;
      if (key === 'rag.queryLog.retentionEnabled') return true;
      return defaultVal;
    }),
  };
}

/**
 * Build a mock DB for retention tests.
 *
 * executeResponses: an ordered list of arrays that .execute() resolves with.
 * Each call to execute() pops the next response.  If exhausted, returns [].
 */
function makeDb(executeResponses: unknown[][] = []) {
  let callIdx = 0;
  const executeFn = vi.fn().mockImplementation(async () => {
    const resp = executeResponses[callIdx++] ?? [];
    return resp;
  });
  return { execute: executeFn, _executeFn: executeFn };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function monthName(offsetMonths: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `rag_query_logs_${y}_${m}`;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RagTraceRetentionService — retention disabled', () => {
  it('does nothing when retentionEnabled is false', async () => {
    const db = makeDb();
    const svc = new RagTraceRetentionService(
      db as any,
      makeConfigService({ 'rag.queryLog.retentionEnabled': false }) as any,
      makeMetrics() as any,
    );
    await svc.runRetention();
    expect(db._executeFn).not.toHaveBeenCalled();
  });
});

describe('RagTraceRetentionService — drops old partitions', () => {
  it('drops a partition whose month is older than retention window', async () => {
    // 3-month-old partition name
    const oldName = monthName(-3);

    // execute calls in order:
    // 1. information_schema query — returns the old partition
    // 2. pg_inherits confirmation — returns count = 1
    // 3. DROP TABLE
    // 4. information_schema check for next-month partition — returns count = 1 (already exists)
    const db = makeDb([
      [{ table_name: oldName }],  // scan for partitions
      [{ count: 1 }],              // pg_inherits confirms it IS a partition
      [],                          // DROP result
      [{ count: 1 }],              // next-month partition already exists
    ]);

    const metrics = makeMetrics();
    const svc = new RagTraceRetentionService(db as any, makeConfigService() as any, metrics as any);
    await svc.runRetention();

    // The DROP call should reference the old partition name.
    const calls = db._executeFn.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const dropCall = calls.find((c: string) => c.includes('DROP TABLE'));
    expect(dropCall).toBeTruthy();
    expect(dropCall).toContain(oldName);

    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_trace_partitions_dropped_total',
      expect.any(String),
      {},
    );
  });

  it('does NOT drop rag_query_logs_default', async () => {
    const db = makeDb([
      [{ table_name: 'rag_query_logs_default' }],
      // pg_inherits should not be called for default; no more responses needed
      [{ count: 1 }], // next-month exists
    ]);

    const metrics = makeMetrics();
    const svc = new RagTraceRetentionService(db as any, makeConfigService() as any, metrics as any);
    await svc.runRetention();

    const calls = db._executeFn.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const dropCall = calls.find((c: string) => c.includes('DROP TABLE'));
    expect(dropCall).toBeUndefined();

    expect(metrics.incrementCounter).not.toHaveBeenCalledWith(
      'rag_trace_partitions_dropped_total',
      expect.any(String),
      {},
    );
  });

  it('does NOT drop a partition that is within the retention window', async () => {
    const recentName = monthName(-1); // one month ago — within 30-day window

    const db = makeDb([
      [{ table_name: recentName }],
      [{ count: 1 }], // next-month exists
    ]);

    const metrics = makeMetrics();
    const svc = new RagTraceRetentionService(db as any, makeConfigService({ 'rag.queryLog.retentionDays': 30 }) as any, metrics as any);
    await svc.runRetention();

    const calls = db._executeFn.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const dropCall = calls.find((c: string) => c.includes('DROP TABLE'));
    expect(dropCall).toBeUndefined();
  });

  it('skips DROP when pg_inherits returns count = 0 (paranoia check)', async () => {
    const oldName = monthName(-4);

    const db = makeDb([
      [{ table_name: oldName }],
      [{ count: 0 }],   // pg_inherits says it is NOT a partition
      [{ count: 1 }],   // next-month exists
    ]);

    const metrics = makeMetrics();
    const svc = new RagTraceRetentionService(db as any, makeConfigService() as any, metrics as any);
    await svc.runRetention();

    const calls = db._executeFn.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const dropCall = calls.find((c: string) => c.includes('DROP TABLE'));
    expect(dropCall).toBeUndefined();

    expect(metrics.incrementCounter).not.toHaveBeenCalledWith(
      'rag_trace_partitions_dropped_total',
      expect.any(String),
      {},
    );
  });
});

describe('RagTraceRetentionService — creates next month partition', () => {
  it('creates next month partition when it does not exist', async () => {
    const db = makeDb([
      [],              // no old partitions to scan
      [{ count: 0 }], // next-month partition does NOT exist
      [],              // CREATE TABLE result
    ]);

    const metrics = makeMetrics();
    const svc = new RagTraceRetentionService(db as any, makeConfigService() as any, metrics as any);
    await svc.runRetention();

    const calls = db._executeFn.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const createCall = calls.find((c: string) => c.includes('CREATE TABLE'));
    expect(createCall).toBeTruthy();
    const expectedName = monthName(1);
    expect(createCall).toContain(expectedName);

    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_trace_partitions_created_total',
      expect.any(String),
      {},
    );
  });

  it('skips CREATE when next month partition already exists', async () => {
    const db = makeDb([
      [],              // no old partitions
      [{ count: 1 }], // next-month already exists
    ]);

    const metrics = makeMetrics();
    const svc = new RagTraceRetentionService(db as any, makeConfigService() as any, metrics as any);
    await svc.runRetention();

    const calls = db._executeFn.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const createCall = calls.find((c: string) => c.includes('CREATE TABLE'));
    expect(createCall).toBeUndefined();

    expect(metrics.incrementCounter).not.toHaveBeenCalledWith(
      'rag_trace_partitions_created_total',
      expect.any(String),
      {},
    );
  });
});

describe('RagTraceRetentionService — error resilience', () => {
  it('does not throw when DB execute rejects', async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error('DB offline')) };
    const svc = new RagTraceRetentionService(db as any, makeConfigService() as any, makeMetrics() as any);
    await expect(svc.runRetention()).resolves.toBeUndefined();
  });
});
