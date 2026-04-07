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
});
