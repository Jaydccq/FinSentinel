import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RetrievalOrchestratorService } from '../retrieval-orchestrator.service';

describe('RetrievalOrchestratorService', () => {
  let service: RetrievalOrchestratorService;
  let mockDenseSearch: { search: Mock };
  let mockSparseSearch: { search: Mock };
  let mockEmbeddingService: { embedQuery: Mock };
  let mockFusion: { fuse: Mock };

  beforeEach(() => {
    mockEmbeddingService = { embedQuery: vi.fn().mockResolvedValue([1, 0]) };
    mockDenseSearch = { search: vi.fn().mockResolvedValue([]) };
    mockSparseSearch = { search: vi.fn().mockResolvedValue([]) };
    mockFusion = { fuse: vi.fn().mockReturnValue([]) };
    service = new RetrievalOrchestratorService(
      mockDenseSearch as any,
      mockSparseSearch as any,
      mockEmbeddingService as any,
      mockFusion as any,
    );
  });

  it('dispatches dense and sparse lanes in parallel and fuses results', async () => {
    mockDenseSearch.search.mockResolvedValueOnce([
      { sourceType: 'document', sourceId: 's1', chunkIndex: 0, content: 'dense-a', embedding: [1, 0], metadata: {}, similarity: 0.9 },
    ]);
    mockSparseSearch.search.mockResolvedValueOnce([
      { chunkId: 'b', sourceId: 's2', content: 'sparse-b', metadata: {}, score: 0.7 },
    ]);
    mockFusion.fuse.mockReturnValueOnce([
      { chunkId: 'a', sourceId: 's1', content: 'dense-a', metadata: {}, rrfScore: 0.02, lanes: ['dense'] },
    ]);

    const result = await service.orchestrate({
      rewrittenQuery: 'AAPL revenue',
      lanes: ['dense', 'sparse'],
      topKPerLane: 10,
      filters: {},
    });

    expect(mockDenseSearch.search).toHaveBeenCalled();
    expect(mockSparseSearch.search).toHaveBeenCalled();
    expect(mockFusion.fuse).toHaveBeenCalledWith(expect.any(Array), 60);
    expect(result).toHaveLength(1);
  });

  it('skips sparse lane when not in plan', async () => {
    mockDenseSearch.search.mockResolvedValueOnce([]);
    mockFusion.fuse.mockReturnValueOnce([]);

    await service.orchestrate({
      rewrittenQuery: 'test',
      lanes: ['dense'],
      topKPerLane: 5,
      filters: {},
    });

    expect(mockDenseSearch.search).toHaveBeenCalled();
    expect(mockSparseSearch.search).not.toHaveBeenCalled();
  });

  it('handles lane failures gracefully via Promise.allSettled', async () => {
    mockDenseSearch.search.mockRejectedValueOnce(new Error('Dense failed'));
    mockSparseSearch.search.mockResolvedValueOnce([]);
    mockFusion.fuse.mockReturnValueOnce([]);

    const result = await service.orchestrate({
      rewrittenQuery: 'test',
      lanes: ['dense', 'sparse'],
      topKPerLane: 5,
      filters: {},
    });

    // Should not throw, sparse results still fused
    expect(mockFusion.fuse).toHaveBeenCalled();
  });
});
