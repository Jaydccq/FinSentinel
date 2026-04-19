import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService } from '../rag-retrieval.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { RagChunkStoreService } from '../rag-chunk-store.service';
import { MetricsService } from '../../common/services/metrics.service';

const FIXTURE_CHUNKS = [
  { id: 'chunk-a1', sourceId: 'src-alpha', similarity: 0.95, doc_type: 'SEC_FILING' },
  { id: 'chunk-b2', sourceId: 'src-beta', similarity: 0.88, doc_type: 'NEWS' },
  { id: 'chunk-c3', sourceId: 'src-gamma', similarity: 0.82, doc_type: 'RESEARCH_REPORT' },
  { id: 'chunk-d4', sourceId: 'src-alpha', similarity: 0.79, doc_type: 'SEC_FILING' },
  { id: 'chunk-e5', sourceId: 'src-delta', similarity: 0.76, doc_type: 'NEWS' },
  { id: 'chunk-f6', sourceId: 'src-beta', similarity: 0.73, doc_type: 'SEC_FILING' },
  { id: 'chunk-g7', sourceId: 'src-gamma', similarity: 0.70, doc_type: 'RESEARCH_REPORT' },
  { id: 'chunk-h8', sourceId: 'src-epsilon', similarity: 0.68, doc_type: 'NEWS' },
  { id: 'chunk-i9', sourceId: 'src-delta', similarity: 0.66, doc_type: 'SEC_FILING' },
  { id: 'chunk-j10', sourceId: 'src-alpha', similarity: 0.64, doc_type: 'NEWS' },
  { id: 'chunk-k11', sourceId: 'src-beta', similarity: 0.55, doc_type: 'RESEARCH_REPORT' },
  { id: 'chunk-l12', sourceId: 'src-gamma', similarity: 0.40, doc_type: 'SEC_FILING' },
].map(({ id, sourceId, similarity, doc_type }) => ({
  id,
  sourceType: 'document' as const,
  sourceId,
  chunkIndex: 0,
  content: `Content for ${id}`,
  embedding: [1, 0],
  metadata: { doc_type },
  similarity,
}));

describe('RagRetrievalService flag-off regression', () => {
  let service: RagRetrievalService;

  beforeEach(async () => {
    const mockEmbeddingService = {
      embedQuery: vi.fn().mockResolvedValue([1, 0]),
    };

    const mockChunkStore = {
      search: vi.fn().mockResolvedValue(FIXTURE_CHUNKS),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: mockEmbeddingService },
        { provide: RagChunkStoreService, useValue: mockChunkStore },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            observeHistogram: vi.fn(),
            startHistogramTimer: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: unknown) => {
              if (key === 'RAG_SIMILARITY_THRESHOLD') return 0.65;
              if (key === 'RAG_MULTI_STAGE_ENABLED') return 'false';
              return defaultVal;
            },
          },
        },
      ],
    }).compile();

    service = module.get(RagRetrievalService);
  });

  it('dense-only top-10 output is stable (flag-off regression lock)', async () => {
    const results = await service.search('apple revenue 2026', 10);

    const snapshot = results.map((r) => ({
      chunkId: r.chunkId,
      sourceId: r.sourceId,
      similarity: r.similarity,
    }));

    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "chunkId": "chunk-a1",
          "similarity": 0.95,
          "sourceId": "src-alpha",
        },
        {
          "chunkId": "chunk-b2",
          "similarity": 0.88,
          "sourceId": "src-beta",
        },
        {
          "chunkId": "chunk-c3",
          "similarity": 0.82,
          "sourceId": "src-gamma",
        },
        {
          "chunkId": "chunk-d4",
          "similarity": 0.79,
          "sourceId": "src-alpha",
        },
        {
          "chunkId": "chunk-e5",
          "similarity": 0.76,
          "sourceId": "src-delta",
        },
        {
          "chunkId": "chunk-f6",
          "similarity": 0.73,
          "sourceId": "src-beta",
        },
        {
          "chunkId": "chunk-g7",
          "similarity": 0.7,
          "sourceId": "src-gamma",
        },
        {
          "chunkId": "chunk-h8",
          "similarity": 0.68,
          "sourceId": "src-epsilon",
        },
        {
          "chunkId": "chunk-i9",
          "similarity": 0.66,
          "sourceId": "src-delta",
        },
      ]
    `);
  });

  it('all results carry non-empty chunkId and sourceId', async () => {
    const results = await service.search('apple revenue 2026', 10);

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => typeof r.chunkId === 'string' && r.chunkId.length > 0)).toBe(true);
    expect(results.every((r) => typeof r.sourceId === 'string' && r.sourceId.length > 0)).toBe(true);
  });

  it('filters out results below RAG_SIMILARITY_THRESHOLD (0.65)', async () => {
    const results = await service.search('apple revenue 2026', 10);

    const belowThreshold = results.filter((r) => r.similarity < 0.65);
    expect(belowThreshold).toHaveLength(0);

    // chunk-j10 (0.64), chunk-k11 (0.55), chunk-l12 (0.40) must not appear
    const ids = results.map((r) => r.chunkId);
    expect(ids).not.toContain('chunk-j10');
    expect(ids).not.toContain('chunk-k11');
    expect(ids).not.toContain('chunk-l12');
  });
});
