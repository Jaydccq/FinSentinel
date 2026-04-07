import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RerankService } from '../rerank.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('RerankService', () => {
  let service: RerankService;

  beforeEach(() => {
    mockFetch.mockReset();
    const configService = {
      get: vi.fn((key: string, defaultVal: unknown) => {
        if (key === 'RERANKER_URL') return 'http://localhost:8100';
        if (key === 'RERANKER_TIMEOUT_MS') return 5000;
        return defaultVal;
      }),
    };
    service = new RerankService(configService as any);
  });

  it('calls sidecar /rerank and returns re-scored candidates', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { id: 'chunk-2', score: 0.95, rank: 1 },
          { id: 'chunk-1', score: 0.80, rank: 2 },
        ],
        model_used: 'bge-reranker-v2-m3',
        latency_ms: 42,
      }),
    });

    const candidates = [
      { chunkId: 'chunk-1', content: 'first', sourceId: 's1', metadata: {}, rrfScore: 0.02, lanes: ['dense'] },
      { chunkId: 'chunk-2', content: 'second', sourceId: 's2', metadata: {}, rrfScore: 0.01, lanes: ['sparse'] },
    ];

    const result = await service.rerank('AAPL revenue', candidates, 10);

    expect(result).toHaveLength(2);
    expect(result[0]!.chunkId).toBe('chunk-2');
    expect(result[0]!.rerankScore).toBe(0.95);
    expect(result[1]!.chunkId).toBe('chunk-1');
  });

  it('returns candidates with rrfScore as fallback when sidecar is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const candidates = [
      { chunkId: 'chunk-1', content: 'first', sourceId: 's1', metadata: {}, rrfScore: 0.02, lanes: ['dense'] },
    ];

    const result = await service.rerank('query', candidates, 10);

    expect(result).toHaveLength(1);
    expect(result[0]!.chunkId).toBe('chunk-1');
    expect(result[0]!.rerankScore).toBe(0.02);
  });
});
