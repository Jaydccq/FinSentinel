import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService, type RagSearchOptions } from '../rag-retrieval.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { RagChunkStoreService } from '../rag-chunk-store.service';
import { MetricsService } from '../../common/services/metrics.service';

describe('RagRetrievalService', () => {
  let service: RagRetrievalService;
  let mockEmbeddingService: { embedQuery: Mock };
  let mockChunkStore: { search: Mock };

  beforeEach(async () => {
    mockEmbeddingService = {
      embedQuery: vi.fn().mockResolvedValue([1, 0]),
    };

    mockChunkStore = {
      search: vi.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: mockEmbeddingService },
        { provide: RagChunkStoreService, useValue: mockChunkStore },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: unknown) => {
              if (key === 'RAG_SIMILARITY_THRESHOLD') return 0.65;
              return defaultVal;
            },
          },
        },
      ],
    }).compile();

    service = module.get(RagRetrievalService);
  });

  it('returns ranked results above the configured similarity threshold', async () => {
    mockChunkStore.search.mockResolvedValueOnce([
      {
        sourceType: 'document',
        sourceId: 'doc-1',
        chunkIndex: 0,
        content: 'Apple revenue grew 12% year-over-year.',
        embedding: [1, 0],
        metadata: { doc_type: 'SEC_FILING', source: '10-Q' },
        similarity: 0.91,
      },
      {
        sourceType: 'news',
        sourceId: 'news-1',
        chunkIndex: 0,
        content: 'AAPL supply chain concern.',
        embedding: [0.8, 0.2],
        metadata: { doc_type: 'NEWS', source: 'POLYGON' },
        similarity: 0.72,
      },
      {
        sourceType: 'document',
        sourceId: 'doc-2',
        chunkIndex: 0,
        content: 'Irrelevant low-similarity result.',
        embedding: [0, 1],
        metadata: { doc_type: 'RESEARCH_REPORT' },
        similarity: 0.5,
      },
    ]);

    const results = await service.search('apple revenue growth');

    expect(results).toHaveLength(2);
    expect(results[0]?.similarity).toBeGreaterThan(results[1]!.similarity);
    expect(results[0]?.content).toContain('Apple revenue');
    expect(results[1]?.content).toContain('supply chain');
  });

  it('passes normalized filters and candidate limit to the chunk store', async () => {
    const opts: RagSearchOptions = {
      query: 'risk assessment for AAPL',
      topK: 3,
      docType: 'SEC_FILING',
      sector: 'Technology',
      regionId: 'US',
      afterDate: '2024-01-01',
    };

    await service.search(opts);

    expect(mockEmbeddingService.embedQuery).toHaveBeenCalledWith('risk assessment for AAPL');
    expect(mockChunkStore.search).toHaveBeenCalledWith(
      [1, 0],
      expect.objectContaining({
        docType: 'SEC_FILING',
        sector: 'Technology',
        regionId: 'US',
        afterDate: '2024-01-01',
        limit: 200,
      }),
    );
  });

  it('accepts positional arguments and clamps topK into range', async () => {
    await service.search('test query', 0, 'NEWS', undefined, undefined, undefined);
    expect(mockChunkStore.search).toHaveBeenLastCalledWith(
      [1, 0],
      expect.objectContaining({ docType: 'NEWS', limit: 200 }),
    );

    await service.search('test query', 1000);
    expect(mockChunkStore.search).toHaveBeenLastCalledWith(
      [1, 0],
      expect.objectContaining({ limit: 1000 }),
    );
  });

  it('returns empty when no chunk clears similarity threshold', async () => {
    mockChunkStore.search.mockResolvedValueOnce([
      {
        sourceType: 'document',
        sourceId: 'doc-1',
        chunkIndex: 0,
        content: 'Low-signal chunk',
        embedding: [1, 0],
        metadata: { doc_type: 'SEC_FILING' },
        similarity: 0.4,
      },
    ]);

    const results = await service.search({ query: 'anything' });
    expect(results).toEqual([]);
  });

  it('reports configured similarity threshold', () => {
    expect(service.getThreshold()).toBe(0.65);
  });
});
