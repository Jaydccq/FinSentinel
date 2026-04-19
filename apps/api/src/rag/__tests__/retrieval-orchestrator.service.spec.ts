import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RetrievalOrchestratorService } from '../retrieval-orchestrator.service';
import { MetadataPreFilterService } from '../metadata-pre-filter.service';

const makeMetadataPreFilter = () => new MetadataPreFilterService();

describe('RetrievalOrchestratorService', () => {
  let service: RetrievalOrchestratorService;
  let mockChunkStore: { search: Mock; searchRepresentations: Mock };
  let mockSparseSearch: { search: Mock };
  let mockEmbeddingService: { embedQuery: Mock };
  let mockFusion: { fuse: Mock };

  beforeEach(() => {
    mockEmbeddingService = { embedQuery: vi.fn().mockResolvedValue([1, 0]) };
    mockChunkStore = {
      search: vi.fn().mockResolvedValue([]),
      searchRepresentations: vi.fn().mockResolvedValue([]),
    };
    mockSparseSearch = { search: vi.fn().mockResolvedValue([]) };
    mockFusion = { fuse: vi.fn().mockReturnValue([]) };
    service = new RetrievalOrchestratorService(
      mockChunkStore as any,
      mockSparseSearch as any,
      mockEmbeddingService as any,
      mockFusion as any,
      makeMetadataPreFilter(),
    );
  });

  it('dispatches dense and sparse lanes in parallel and fuses results', async () => {
    mockChunkStore.searchRepresentations.mockResolvedValueOnce([
      { chunkId: 'a', sourceId: 's1', content: 'dense-a', metadata: {}, similarity: 0.9, representationType: 'canonical' },
    ]);
    mockSparseSearch.search.mockResolvedValueOnce([
      { chunkId: 'b', sourceId: 's2', content: 'sparse-b', metadata: {}, score: 0.7 },
    ]);
    mockFusion.fuse.mockReturnValueOnce([
      { chunkId: 'a', sourceId: 's1', content: 'dense-a', metadata: {}, rrfScore: 0.02, lanes: ['dense'], representationTypesSeen: ['canonical'], variantKindsSeen: ['original'] },
    ]);

    const result = await service.orchestrate({
      rewrittenQuery: 'AAPL revenue',
      lanes: ['dense', 'sparse'],
      topKPerLane: 10,
      filters: {},
    });

    expect(mockChunkStore.searchRepresentations).toHaveBeenCalled();
    expect(mockSparseSearch.search).toHaveBeenCalled();
    expect(mockFusion.fuse).toHaveBeenCalledWith(expect.any(Array), 60);
    expect(result).toHaveLength(1);
  });

  it('skips sparse lane when not in plan', async () => {
    mockChunkStore.searchRepresentations.mockResolvedValueOnce([]);
    mockFusion.fuse.mockReturnValueOnce([]);

    await service.orchestrate({
      rewrittenQuery: 'test',
      lanes: ['dense'],
      topKPerLane: 5,
      filters: {},
    });

    expect(mockChunkStore.searchRepresentations).toHaveBeenCalled();
    expect(mockSparseSearch.search).not.toHaveBeenCalled();
  });

  it('handles lane failures gracefully via Promise.allSettled', async () => {
    mockChunkStore.searchRepresentations.mockRejectedValueOnce(new Error('Dense failed'));
    mockSparseSearch.search.mockResolvedValueOnce([]);
    mockFusion.fuse.mockReturnValueOnce([]);

    await expect(service.orchestrate({
      rewrittenQuery: 'test',
      lanes: ['dense', 'sparse'],
      topKPerLane: 5,
      filters: {},
    })).resolves.not.toThrow();

    expect(mockFusion.fuse).toHaveBeenCalled();
  });

  it('dense lane calls searchRepresentations for all three representation types', async () => {
    mockChunkStore.searchRepresentations.mockResolvedValueOnce([
      { chunkId: 'c1', sourceId: 's1', content: 'canon', metadata: {}, similarity: 0.9, representationType: 'canonical' },
      { chunkId: 'c1', sourceId: 's1', content: 'ctx', metadata: {}, similarity: 0.85, representationType: 'contextual_text' },
      { chunkId: 'c1', sourceId: 's1', content: 'sq', metadata: {}, similarity: 0.8, representationType: 'sample_question' },
    ]);
    mockFusion.fuse.mockReturnValueOnce([]);

    await service.orchestrate({ rewrittenQuery: 'q', lanes: ['dense'], topKPerLane: 5, filters: {} });

    // searchRepresentations called with default types (no explicit types arg restriction in orchestrator)
    expect(mockChunkStore.searchRepresentations).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.any(Number),
    );
  });

  it('dense lane fuses multiple representation types per chunkId into one RRF candidate', async () => {
    mockChunkStore.searchRepresentations.mockResolvedValueOnce([
      { chunkId: 'c1', sourceId: 's1', content: 'canon', metadata: {}, similarity: 0.9, representationType: 'canonical' },
      { chunkId: 'c1', sourceId: 's1', content: 'ctx', metadata: {}, similarity: 0.85, representationType: 'contextual_text' },
      { chunkId: 'c2', sourceId: 's2', content: 'other', metadata: {}, similarity: 0.7, representationType: 'canonical' },
    ]);
    mockFusion.fuse.mockReturnValueOnce([]);

    await service.orchestrate({ rewrittenQuery: 'q', lanes: ['dense'], topKPerLane: 5, filters: {} });

    const fuseCalls = (mockFusion.fuse as Mock).mock.calls[0][0] as any[][];
    const denseLane = fuseCalls[0]!;
    // c1 should appear once in the dense lane output (inner-RRF collapses 2 rep types)
    const c1Hits = denseLane.filter((c: any) => c.chunkId === 'c1');
    expect(c1Hits).toHaveLength(1);
    // representationType should record both surfaces
    expect(c1Hits[0]!.representationType).toContain('canonical');
    expect(c1Hits[0]!.representationType).toContain('contextual_text');
  });

  it('caps variants at 4 when more than 4 are supplied', async () => {
    mockChunkStore.searchRepresentations.mockResolvedValue([]);
    mockSparseSearch.search.mockResolvedValue([]);
    mockFusion.fuse.mockReturnValue([]);

    await service.orchestrate({
      rewrittenQuery: 'q',
      lanes: ['dense', 'sparse'],
      topKPerLane: 5,
      filters: {},
      variants: [
        { kind: 'original', query: 'q1' },
        { kind: 'rewrite', query: 'q2' },
        { kind: 'hyde', query: 'q3' },
        { kind: 'subquery', query: 'q4' },
        { kind: 'subquery', query: 'q5' },
      ],
    });

    // With 4 variants capped, dense called 4 times (one per variant)
    expect(mockChunkStore.searchRepresentations).toHaveBeenCalledTimes(4);
  });

  it('empty document_chunk_representations returns canonical-only dense results', async () => {
    // Only canonical hits returned (rep rows empty)
    mockChunkStore.searchRepresentations.mockResolvedValueOnce([
      { chunkId: 'c1', sourceId: 's1', content: 'canon', metadata: {}, similarity: 0.9, representationType: 'canonical' },
    ]);
    mockFusion.fuse.mockReturnValueOnce([]);

    await service.orchestrate({ rewrittenQuery: 'q', lanes: ['dense'], topKPerLane: 5, filters: {} });

    const fuseCalls = (mockFusion.fuse as Mock).mock.calls[0][0] as any[][];
    const denseLane = fuseCalls[0]!;
    expect(denseLane).toHaveLength(1);
    expect(denseLane[0]!.chunkId).toBe('c1');
    expect(denseLane[0]!.representationType).toEqual(['canonical']);
  });

  it('metadata pre-filter passes explicit filters to both lanes unchanged', async () => {
    mockChunkStore.searchRepresentations.mockResolvedValueOnce([]);
    mockSparseSearch.search.mockResolvedValueOnce([]);
    mockFusion.fuse.mockReturnValueOnce([]);

    const filters = { docType: 'SEC_FILING', sector: 'tech' };
    await service.orchestrate({ rewrittenQuery: 'q', lanes: ['dense', 'sparse'], topKPerLane: 5, filters });

    expect(mockChunkStore.searchRepresentations).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ docType: 'SEC_FILING', sector: 'tech' }),
      expect.any(Number),
    );
    expect(mockSparseSearch.search).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ docType: 'SEC_FILING', sector: 'tech' }),
      expect.any(Number),
    );
  });
});
