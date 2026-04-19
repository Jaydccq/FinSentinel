import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService, type RagSearchOptions } from '../rag-retrieval.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { RagChunkStoreService } from '../rag-chunk-store.service';
import { MetricsService } from '../../common/services/metrics.service';
import { RerankService } from '../rerank.service';
import { ContextPackerService } from '../context-packer.service';
import { ContextExpanderService } from '../context-expander.service';
import { RetrievalPlannerService } from '../retrieval-planner.service';
import { RetrievalOrchestratorService } from '../retrieval-orchestrator.service';
import { RagTraceService } from '../rag-trace.service';

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
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn(), startHistogramTimer: vi.fn(() => vi.fn()) },
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
        id: 'chunk-uuid-1',
        sourceType: 'document',
        sourceId: 'doc-1',
        chunkIndex: 0,
        content: 'Apple revenue grew 12% year-over-year.',
        embedding: [1, 0],
        metadata: { doc_type: 'SEC_FILING', source: '10-Q' },
        similarity: 0.91,
      },
      {
        id: 'chunk-uuid-2',
        sourceType: 'news',
        sourceId: 'news-1',
        chunkIndex: 0,
        content: 'AAPL supply chain concern.',
        embedding: [0.8, 0.2],
        metadata: { doc_type: 'NEWS', source: 'POLYGON' },
        similarity: 0.72,
      },
      {
        id: 'chunk-uuid-3',
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
    expect(results[0]?.chunkId).toBe('chunk-uuid-1');
    expect(results[0]?.sourceId).toBe('doc-1');
    expect(results[1]?.chunkId).toBe('chunk-uuid-2');
    expect(results[1]?.sourceId).toBe('news-1');
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
        id: 'chunk-uuid-low',
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

describe('RagRetrievalService multi-stage pipeline (reranker -> expander -> packer)', () => {
  it('wires reranker, expander, and packer in order', async () => {
    const fusedCandidate = {
      chunkId: 'c1',
      sourceId: 'src-1',
      content: 'fused content',
      metadata: {},
      rrfScore: 0.05,
      lanes: ['dense'],
      representationTypesSeen: ['canonical'],
      variantKindsSeen: ['original'],
    };

    const rerankedCandidate = { ...fusedCandidate, rerankScore: 0.9, fallbackReason: null };
    const expandedCandidate = { ...rerankedCandidate, chunkId: 'c1-expanded', rerankScore: 0.675 };

    const mockPlanner = {
      plan: vi.fn().mockResolvedValue({
        rewrittenQuery: 'AAPL revenue 2026',
        lanes: ['dense'],
        topKPerLane: 20,
      }),
    };

    const mockOrchestrator = {
      orchestrate: vi.fn().mockResolvedValue({ fused: [fusedCandidate], laneCounts: { dense: 20 } }),
    };

    const mockReranker = {
      rerank: vi.fn().mockResolvedValue([rerankedCandidate]),
    };

    const mockExpander = {
      expand: vi.fn().mockResolvedValue([rerankedCandidate, expandedCandidate]),
    };

    const mockPacker = {
      pack: vi.fn().mockReturnValue({
        chunks: [
          { chunkId: 'c1', sourceId: 'src-1', content: 'fused content', metadata: {} },
        ],
        totalTokenEstimate: 10,
      }),
    };

    const mockTrace = {
      recordTrace: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: { embedQuery: vi.fn().mockResolvedValue([1, 0]) } },
        { provide: RagChunkStoreService, useValue: { search: vi.fn().mockResolvedValue([]) } },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: unknown) => {
              if (key === 'RAG_SIMILARITY_THRESHOLD') return 0.65;
              if (key === 'RAG_MULTI_STAGE_ENABLED') return 'true';
              return defaultVal;
            },
          },
        },
        { provide: RetrievalPlannerService, useValue: mockPlanner },
        { provide: RetrievalOrchestratorService, useValue: mockOrchestrator },
        { provide: RerankService, useValue: mockReranker },
        { provide: ContextPackerService, useValue: mockPacker },
        { provide: ContextExpanderService, useValue: mockExpander },
        { provide: RagTraceService, useValue: mockTrace },
      ],
    }).compile();

    const svc = module.get(RagRetrievalService);
    const results = await svc.search('AAPL revenue', 5);

    expect(mockReranker.rerank).toHaveBeenCalledOnce();
    expect(mockExpander.expand).toHaveBeenCalledWith(
      [rerankedCandidate],
      { neighborChunks: 1, fetchParentSection: true },
    );
    expect(mockPacker.pack).toHaveBeenCalledWith(
      [rerankedCandidate, expandedCandidate],
      expect.any(Object),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.chunkId).toBe('c1');

    // Trace must receive non-empty laneCounts and representationTypesSeen
    expect(mockTrace.recordTrace).toHaveBeenCalledOnce();
    const traceArg = (mockTrace.recordTrace as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(traceArg['laneCounts']).toEqual({ dense: 20 });
    expect(traceArg['representationTypesSeen']).toEqual(['canonical']);
  });

  it('skips expander when it is not provided (Optional dep)', async () => {
    const fusedCandidate = {
      chunkId: 'c1',
      sourceId: 'src-1',
      content: 'content',
      metadata: {},
      rrfScore: 0.05,
      lanes: ['dense'],
      representationTypesSeen: [],
      variantKindsSeen: [],
    };

    const rerankedCandidate = { ...fusedCandidate, rerankScore: 0.9, fallbackReason: null };

    const mockPlanner = {
      plan: vi.fn().mockResolvedValue({ rewrittenQuery: 'q', lanes: ['dense'], topKPerLane: 20 }),
    };
    const mockOrchestrator = {
      orchestrate: vi.fn().mockResolvedValue({ fused: [fusedCandidate], laneCounts: { dense: 1 } }),
    };
    const mockReranker = { rerank: vi.fn().mockResolvedValue([rerankedCandidate]) };
    const mockPacker = {
      pack: vi.fn().mockReturnValue({
        chunks: [{ chunkId: 'c1', sourceId: 'src-1', content: 'content', metadata: {} }],
        totalTokenEstimate: 5,
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: { embedQuery: vi.fn().mockResolvedValue([1, 0]) } },
        { provide: RagChunkStoreService, useValue: { search: vi.fn().mockResolvedValue([]) } },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: unknown) => {
              if (key === 'RAG_SIMILARITY_THRESHOLD') return 0.65;
              if (key === 'RAG_MULTI_STAGE_ENABLED') return 'true';
              return defaultVal;
            },
          },
        },
        { provide: RetrievalPlannerService, useValue: mockPlanner },
        { provide: RetrievalOrchestratorService, useValue: mockOrchestrator },
        { provide: RerankService, useValue: mockReranker },
        { provide: ContextPackerService, useValue: mockPacker },
        // ContextExpanderService intentionally omitted
      ],
    }).compile();

    const svc = module.get(RagRetrievalService);
    await svc.search('AAPL revenue', 5);

    // Packer receives raw reranked output directly (no expansion)
    expect(mockPacker.pack).toHaveBeenCalledWith([rerankedCandidate], expect.any(Object));
  });
});
