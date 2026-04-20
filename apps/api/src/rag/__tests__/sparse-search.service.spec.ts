import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SparseSearchService } from '../sparse-search.service';

describe('SparseSearchService', () => {
  let service: SparseSearchService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execute: vi.fn().mockResolvedValue([]),
    };
    service = new SparseSearchService(mockDb);
  });

  it('returns empty array when no matches', async () => {
    const results = await service.search('nonexistent query', {}, 10);
    expect(results).toEqual([]);
    expect(mockDb.execute).toHaveBeenCalled();
  });

  it('returns ranked candidates with boosted scores', async () => {
    mockDb.execute.mockResolvedValueOnce([
      {
        id: 'chunk-1',
        source_id: 'doc-1',
        content: 'Apple revenue Q3',
        metadata: { doc_type: 'SEC_FILING' },
        rank_score: 0.8,
        hit_count: 3,
      },
      {
        id: 'chunk-2',
        source_id: 'doc-2',
        content: 'AAPL guidance',
        metadata: { doc_type: 'NEWS' },
        rank_score: 0.5,
        hit_count: 1,
      },
    ]);

    const results = await service.search('AAPL revenue', {}, 10);

    expect(results).toHaveLength(2);
    expect(results[0]!.chunkId).toBe('chunk-1');
    // Doc-level boosted score: 0.8 * (1 + 0.1 * ln(3)) > 0.8
    expect(results[0]!.score).toBeGreaterThan(0.8);
    expect(results[1]!.chunkId).toBe('chunk-2');
    // Single hit: ln(1) = 0, so boosted = 0.5 * 1.0 = 0.5
    expect(results[1]!.score).toBeCloseTo(0.5);
  });

  it('returns empty for whitespace-only query', async () => {
    const results = await service.search('   ', {}, 10);
    expect(results).toEqual([]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns canonical-only candidates when no representation rows exist (fallback)', async () => {
    // Simulates a fresh DB: representation rows return no matches, only canonical chunk rows.
    mockDb.execute.mockResolvedValueOnce([
      {
        id: 'chunk-canon',
        source_id: 'doc-1',
        content: 'canonical content',
        metadata: {},
        rank_score: 0.6,
        hit_count: 1,
      },
    ]);

    const results = await service.search('some term', {}, 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.chunkId).toBe('chunk-canon');
  });

  it('merges representation matches with canonical matches by chunkId', async () => {
    // Simulates a chunk that matches both via canonical search_vector and via rep rows.
    // The merged SQL takes MAX rank_score per chunkId, so c1 appears once with the higher score.
    mockDb.execute.mockResolvedValueOnce([
      {
        id: 'c1',
        source_id: 'doc-1',
        content: 'canonical text',
        metadata: {},
        rank_score: 0.9,
        hit_count: 2,
      },
    ]);

    const results = await service.search('AAPL', {}, 10);
    const ids = results.map(r => r.chunkId);
    expect(ids.filter(id => id === 'c1')).toHaveLength(1);
  });

  it('SQL includes representation_type IN filter for representation table query', async () => {
    mockDb.execute.mockResolvedValueOnce([]);
    await service.search('Bitcoin', {}, 5);

    const callArg = mockDb.execute.mock.calls[0][0];
    // The SQL template should reference representation_type IN clause
    const sqlStr = JSON.stringify(callArg);
    expect(sqlStr).toContain('representation_type');
    expect(sqlStr).toContain('keyword_entity');
  });

  describe('field-weighted ranking (R2.3/R2.4)', () => {
    it('threads the weight vector into ts_rank_cd as a float4[] parameter', async () => {
      // R2.3: the current service must use `ts_rank_cd(weights, vector, query)`,
      // not the default `ts_rank_cd(vector, query)`. Verifying via SQL inspection
      // because a true title-vs-tail ranking test needs a live Postgres with a
      // seeded representation row — covered in the eval harness, not here.
      const weights: [number, number, number, number] = [0.1, 0.2, 0.4, 1.0];
      mockDb.execute.mockResolvedValueOnce([]);
      const svc = new SparseSearchService(mockDb, weights);
      await svc.search('counterparty risk', {}, 10);

      const callArg = mockDb.execute.mock.calls[0][0];
      const sqlStr = JSON.stringify(callArg);
      // Weight literal must be PG-array form, typecast to float4[], and appear
      // for BOTH ranking sites (canonical + representation lane).
      expect(sqlStr).toContain('{0.1,0.2,0.4,1}');
      expect(sqlStr).toContain('float4[]');
      // Each ranking expression should reference the weight vector:
      // ts_rank_cd(<weights>::float4[], <vector>, <query>) — so the fragment
      // appears once for canonical_ranked and once for rep_ranked.
      const occurrences = (sqlStr.match(/float4\[\]/g) || []).length;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    });

    it('uses the configured weights (override) instead of the default vector', async () => {
      // Verifies RAG_SPARSE_WEIGHTS propagation — a non-default vector must
      // reach the SQL rather than being silently ignored.
      const custom: [number, number, number, number] = [0, 0.25, 0.5, 0.75];
      mockDb.execute.mockResolvedValueOnce([]);
      const svc = new SparseSearchService(mockDb, custom);
      await svc.search('anything', {}, 5);

      const sqlStr = JSON.stringify(mockDb.execute.mock.calls[0][0]);
      expect(sqlStr).toContain('{0,0.25,0.5,0.75}');
      // The default must NOT leak through when a custom vector is supplied.
      expect(sqlStr).not.toContain('{0.1,0.2,0.4,1}');
    });

    it('preserves rank order for title-hit above chunk-tail-hit (contract test)', async () => {
      // With the weight vector `{0.1, 0.2, 0.4, 1.0}`, a representation row
      // whose A-slot lexemes (title + section_path) contain the query tokens
      // will out-rank a canonical-chunk row whose tokens land in its B-slot
      // body. This test asserts the consumer-side contract: the service
      // returns rows in descending rank order, so the higher-ranked
      // title-hit surfaces at position 0. DB-level proof of *why* the
      // title-hit wins lives in the eval harness against a seeded Postgres.
      const titleHitChunkId = 'chunk-title-hit';
      const tailHitChunkId = 'chunk-tail-hit';
      mockDb.execute.mockResolvedValueOnce([
        {
          id: titleHitChunkId,
          source_id: 'doc-1',
          content: 'tail-body text',
          metadata: {},
          rank_score: 0.85, // A-slot hit, multiplied by weight 1.0
          hit_count: 1,
        },
        {
          id: tailHitChunkId,
          source_id: 'doc-2',
          content: 'body-only content',
          metadata: {},
          rank_score: 0.12, // C/B-slot hit, multiplied by weight 0.2–0.4
          hit_count: 1,
        },
      ]);

      const weights: [number, number, number, number] = [0.1, 0.2, 0.4, 1.0];
      const svc = new SparseSearchService(mockDb, weights);
      const hits = await svc.search('counterparty risk', {}, 10);

      expect(hits[0]!.chunkId).toBe(titleHitChunkId);
      expect(hits[1]!.chunkId).toBe(tailHitChunkId);
    });

    it('defaults to [0.1, 0.2, 0.4, 1.0] when no weights override is supplied', async () => {
      // Confirms the no-arg constructor path keeps the documented default.
      mockDb.execute.mockResolvedValueOnce([]);
      const svc = new SparseSearchService(mockDb);
      await svc.search('something', {}, 5);

      const sqlStr = JSON.stringify(mockDb.execute.mock.calls[0][0]);
      expect(sqlStr).toContain('{0.1,0.2,0.4,1}');
    });
  });
});
