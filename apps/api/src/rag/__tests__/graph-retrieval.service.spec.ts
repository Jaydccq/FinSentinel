import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphRetrievalService } from '../graph-retrieval.service';

describe('GraphRetrievalService', () => {
  let service: GraphRetrievalService;
  let mockDb: any;
  let mockEmbeddingService: any;

  beforeEach(() => {
    mockDb = { execute: vi.fn().mockResolvedValue([]) };
    mockEmbeddingService = { embedQuery: vi.fn().mockResolvedValue([1, 0]) };
    service = new GraphRetrievalService(mockDb, mockEmbeddingService);
  });

  it('returns empty when no entity names provided', async () => {
    const results = await service.search([], 'some query', 10);
    expect(results).toEqual([]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns empty when no entities match in DB', async () => {
    mockDb.execute.mockResolvedValueOnce([]);
    const results = await service.search(['Nonexistent Corp'], 'query', 10);
    expect(results).toEqual([]);
  });

  it('returns candidates tagged with graph lane', async () => {
    mockDb.execute.mockResolvedValueOnce([{ id: 'entity-1' }]).mockResolvedValueOnce([
      {
        chunk_id: 'c1',
        source_id: 'doc-1',
        content: 'Apple supplies components',
        metadata: { doc_type: 'NEWS' },
        embedding: [0.9, 0.1],
        relation_confidence: 0.85,
        hop_distance: 1,
      },
    ]);

    const results = await service.search(['Apple'], 'Apple supply chain', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('lane', 'graph');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('chunkId', 'c1');
  });

  it('filters out low-score candidates (below 0.3)', async () => {
    mockDb.execute.mockResolvedValueOnce([{ id: 'entity-1' }]).mockResolvedValueOnce([
      {
        chunk_id: 'c1',
        source_id: 'doc-1',
        content: 'Irrelevant content',
        metadata: {},
        embedding: [0, 1], // orthogonal to query embedding [1,0] → cosine = 0
        relation_confidence: 0.1,
        hop_distance: 2,
      },
    ]);

    const results = await service.search(['Test'], 'unrelated query', 10);
    // Score would be 0.4 * (0.1 * 0.6) + 0.6 * 0 = 0.024 → below 0.3
    expect(results).toHaveLength(0);
  });
});
