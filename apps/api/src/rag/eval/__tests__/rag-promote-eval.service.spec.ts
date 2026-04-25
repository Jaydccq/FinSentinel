import { describe, it, expect } from 'vitest';
import {
  stratifiedSample,
  redactPii,
  buildPromotedRow,
  appendPromotedRows,
  summarizeByClass,
  type GoldenSetFile,
  type PromotedRow,
} from '../rag-promote-eval.service';

describe('stratifiedSample', () => {
  it('returns balanced rows across query classes', () => {
    const logs = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, query_class: 'factoid' })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, query_class: 'exact_lookup' })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, query_class: 'analytical' })),
    ];
    const out = stratifiedSample(logs, { perClass: 5 });
    const counts = out.reduce<Record<string, number>>((acc, r) => {
      acc[r.query_class] = (acc[r.query_class] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts['factoid']).toBe(5);
    expect(counts['exact_lookup']).toBe(5);
    expect(counts['analytical']).toBe(5);
  });

  it('caps to available rows when a class is short', () => {
    const logs = [
      { id: 'f1', query_class: 'factoid' },
      { id: 'f2', query_class: 'factoid' },
    ];
    expect(stratifiedSample(logs, { perClass: 5 })).toHaveLength(2);
  });
});

describe('redactPii', () => {
  it('drops API key prefixes', () => {
    const out = redactPii('What does sk-abcdef1234567890ABCDEF1234567890 do?');
    expect(out).not.toContain('sk-abcdef');
    expect(out).toContain('[redacted-token]');
  });

  it('replaces email-like tokens', () => {
    expect(redactPii('email me at jane@example.com')).toMatch(/\[redacted-email\]/);
  });

  it('passes through ordinary text', () => {
    expect(redactPii('show AAPL 10-K filings')).toBe('show AAPL 10-K filings');
  });

  it('redacts phone numbers', () => {
    expect(redactPii('call +1 415 555 1212 today')).toMatch(/\[redacted-phone\]/);
  });
});

describe('buildPromotedRow', () => {
  it('produces a row that mirrors the golden-set shape with promoted provenance', () => {
    const row = buildPromotedRow(
      {
        id: 'log-1',
        query_preview: 'AAPL 10-K FY2024 revenue',
        query_class: 'exact_lookup',
        result_chunk_ids: ['c1', 'c2', 'c3'],
        created_at: '2026-04-20T00:00:00Z',
      },
      { promotedAt: '2026-04-25T00:00:00Z' },
    );
    expect(row.provenance_label).toBe('real_user_promoted');
    expect(row.source_query_log_id).toBe('log-1');
    expect(row.expected_chunk_ids).toEqual(['c1', 'c2', 'c3']);
    expect(row.query).toBe('AAPL 10-K FY2024 revenue');
    expect(row.query_class).toBe('exact_lookup');
    expect(row.id).toBe('promoted-log-1');
    expect(row.promoted_at).toBe('2026-04-25T00:00:00Z');
    expect(row.redactions_applied).toEqual([]);
    expect(row.acceptable_chunk_ids).toEqual([]);
    expect(row.expected_source_docs).toEqual([]);
    expect(row.tags).toContain('real_user_promoted');
  });

  it('records redactions_applied when query contains PII', () => {
    const row = buildPromotedRow(
      {
        id: 'log-2',
        query_preview: 'send to admin@finsentinel.test about AAPL',
        query_class: 'factoid',
        result_chunk_ids: [],
      },
      { promotedAt: '2026-04-25T00:00:00Z' },
    );
    expect(row.redactions_applied).toContain('email');
    expect(row.query).not.toContain('admin@finsentinel.test');
  });

  it('handles missing query_preview by emitting empty string', () => {
    const row = buildPromotedRow(
      { id: 'log-3', query_preview: null, query_class: 'factoid' },
      { promotedAt: '2026-04-25T00:00:00Z' },
    );
    expect(row.query).toBe('');
  });
});

describe('appendPromotedRows', () => {
  function mkRow(overrides: Partial<PromotedRow>): PromotedRow {
    return {
      id: 'promoted-x',
      query: 'q',
      query_class: 'factoid',
      expected_chunk_ids: [],
      acceptable_chunk_ids: [],
      expected_source_docs: [],
      expected_answer: '',
      expected_entities: [],
      difficulty: 'unlabelled',
      tags: ['factoid', 'real_user_promoted'],
      provenance_label: 'real_user_promoted',
      source_query_log_id: 'log-x',
      promoted_at: '2026-04-25T00:00:00Z',
      redactions_applied: [],
      ...overrides,
    };
  }

  it('appends new rows and skips duplicates by source_query_log_id', () => {
    const golden: GoldenSetFile = {
      version: '2.1',
      entries: [
        { id: 'gs-001', source_query_log_id: 'log-1' },
        { id: 'gs-002' },
      ],
    };
    const result = appendPromotedRows(golden, [
      mkRow({ source_query_log_id: 'log-1', id: 'promoted-log-1' }),
      mkRow({ source_query_log_id: 'log-2', id: 'promoted-log-2' }),
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.source_query_log_id).toBe('log-2');
    expect(result.skipped).toEqual([{ source_query_log_id: 'log-1', reason: 'duplicate' }]);
    expect(golden.entries).toHaveLength(3);
  });

  it('skips intra-batch duplicates', () => {
    const golden: GoldenSetFile = { version: '2.1', entries: [] };
    const result = appendPromotedRows(golden, [
      mkRow({ source_query_log_id: 'log-1' }),
      mkRow({ source_query_log_id: 'log-1' }),
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });
});

describe('summarizeByClass', () => {
  it('counts rows by class', () => {
    const summary = summarizeByClass([
      { query_class: 'factoid' },
      { query_class: 'factoid' },
      { query_class: 'exact_lookup' },
    ]);
    expect(summary.classes).toEqual({ factoid: 2, exact_lookup: 1 });
    expect(summary.total).toBe(3);
  });

  it('returns empty for no rows', () => {
    expect(summarizeByClass([])).toEqual({ classes: {}, total: 0 });
  });
});
