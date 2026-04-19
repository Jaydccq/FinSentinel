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
});
