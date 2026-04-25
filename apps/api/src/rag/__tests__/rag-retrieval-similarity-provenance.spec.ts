import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService } from '../rag-retrieval.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { RagChunkStoreService } from '../rag-chunk-store.service';
import { MetricsService } from '../../common/services/metrics.service';
import { RerankService } from '../rerank.service';
import { ContextPackerService } from '../context-packer.service';
import { ContextExpanderService } from '../context-expander.service';
import { RetrievalPlannerService } from '../retrieval-planner.service';
import { RetrievalOrchestratorService } from '../retrieval-orchestrator.service';

/**
 * R3.5 — similarity backward-compat contract tests.
 *
 * Goal: `similarity` stays REQUIRED and populated on every RagSearchResult,
 * including multi-stage (rerank success + RRF fallback) paths. New optional
 * provenance fields (`rankScore`, `fusionScore`, `scoreSource`) reveal where
 * the score came from without breaking downstream consumers such as
 * `news-analysis.service.ts:120` (`result.similarity * 100` formatting).
 */
async function buildMultiStageService(opts: {
  plannerResult: Record<string, unknown>;
  fused: Array<Record<string, unknown>>;
  reranked: Array<Record<string, unknown>>;
  packed: Array<{
    chunkId: string;
    sourceId: string;
    content: string;
    metadata: Record<string, unknown>;
  }>;
}) {
  const mockPlanner = { plan: vi.fn().mockResolvedValue(opts.plannerResult) };
  const mockOrchestrator = {
    orchestrate: vi
      .fn()
      .mockResolvedValue({ fused: opts.fused, laneCounts: { dense: opts.fused.length } }),
  };
  const mockReranker = { rerank: vi.fn().mockResolvedValue(opts.reranked) };
  const mockPacker = {
    pack: vi.fn().mockReturnValue({ chunks: opts.packed, totalTokenEstimate: 10 }),
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
    ],
  }).compile();

  return module.get(RagRetrievalService);
}

const BASE_FUSED = {
  chunkId: 'c1',
  sourceId: 'src-1',
  content: 'fused content',
  metadata: {},
  rrfScore: 0.08,
  lanes: ['dense'],
  representationTypesSeen: ['canonical'],
  variantKindsSeen: ['original'],
};

describe('RagRetrievalService multi-stage similarity contract (R3.5)', () => {
  describe('rerank success path', () => {
    it('similarity is a finite number in (0, 1)', async () => {
      const reranked = [{ ...BASE_FUSED, rerankScore: 2.4, fallbackReason: null }];
      const svc = await buildMultiStageService({
        plannerResult: { rewrittenQuery: 'q', rerankQuery: 'q', lanes: ['dense'], topKPerLane: 20 },
        fused: [BASE_FUSED],
        reranked,
        packed: [{ chunkId: 'c1', sourceId: 'src-1', content: 'fused content', metadata: {} }],
      });

      const results = await svc.search('q', 5);
      expect(results).toHaveLength(1);
      const r = results[0]!;
      expect(typeof r.similarity).toBe('number');
      expect(Number.isFinite(r.similarity)).toBe(true);
      expect(r.similarity).toBeGreaterThan(0);
      expect(r.similarity).toBeLessThan(1);
    });

    it('rankScore is set to the raw reranker score, fusionScore undefined, scoreSource=rerank', async () => {
      const reranked = [{ ...BASE_FUSED, rerankScore: 2.4, fallbackReason: null }];
      const svc = await buildMultiStageService({
        plannerResult: { rewrittenQuery: 'q', rerankQuery: 'q', lanes: ['dense'], topKPerLane: 20 },
        fused: [BASE_FUSED],
        reranked,
        packed: [{ chunkId: 'c1', sourceId: 'src-1', content: 'fused content', metadata: {} }],
      });

      const results = await svc.search('q', 5);
      const r = results[0]!;
      expect(r.rankScore).toBe(2.4);
      expect(r.fusionScore).toBeUndefined();
      expect(r.scoreSource).toBe('rerank');
    });

    it('similarity is monotonic with rerankScore across candidates', async () => {
      const fused = [
        { ...BASE_FUSED, chunkId: 'c1' },
        { ...BASE_FUSED, chunkId: 'c2' },
        { ...BASE_FUSED, chunkId: 'c3' },
      ];
      const reranked = [
        { ...fused[0], rerankScore: 3.0, fallbackReason: null },
        { ...fused[1], rerankScore: 0.5, fallbackReason: null },
        { ...fused[2], rerankScore: -1.2, fallbackReason: null },
      ];
      const svc = await buildMultiStageService({
        plannerResult: { rewrittenQuery: 'q', rerankQuery: 'q', lanes: ['dense'], topKPerLane: 20 },
        fused,
        reranked,
        packed: [
          { chunkId: 'c1', sourceId: 'src-1', content: 'x', metadata: {} },
          { chunkId: 'c2', sourceId: 'src-2', content: 'x', metadata: {} },
          { chunkId: 'c3', sourceId: 'src-3', content: 'x', metadata: {} },
        ],
      });

      const results = await svc.search('q', 5);
      expect(results).toHaveLength(3);
      // Monotonic by rerankScore: c1 > c2 > c3
      expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
      expect(results[1]!.similarity).toBeGreaterThan(results[2]!.similarity);
    });
  });

  describe('RRF fallback path (reranker unavailable / malformed)', () => {
    it('similarity is a finite number in [0, 1]', async () => {
      const reranked = [
        { ...BASE_FUSED, rerankScore: 0.08, fallbackReason: 'rerank_unavailable' as const },
      ];
      const svc = await buildMultiStageService({
        plannerResult: { rewrittenQuery: 'q', rerankQuery: 'q', lanes: ['dense'], topKPerLane: 20 },
        fused: [BASE_FUSED],
        reranked,
        packed: [{ chunkId: 'c1', sourceId: 'src-1', content: 'fused content', metadata: {} }],
      });

      const results = await svc.search('q', 5);
      const r = results[0]!;
      expect(typeof r.similarity).toBe('number');
      expect(Number.isFinite(r.similarity)).toBe(true);
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    });

    it('fusionScore is set to the raw RRF score, rankScore undefined, scoreSource=rrf', async () => {
      const reranked = [
        { ...BASE_FUSED, rerankScore: 0.08, fallbackReason: 'rerank_unavailable' as const },
      ];
      const svc = await buildMultiStageService({
        plannerResult: { rewrittenQuery: 'q', rerankQuery: 'q', lanes: ['dense'], topKPerLane: 20 },
        fused: [BASE_FUSED],
        reranked,
        packed: [{ chunkId: 'c1', sourceId: 'src-1', content: 'fused content', metadata: {} }],
      });

      const results = await svc.search('q', 5);
      const r = results[0]!;
      expect(r.fusionScore).toBe(0.08);
      expect(r.rankScore).toBeUndefined();
      expect(r.scoreSource).toBe('rrf');
    });
  });

  describe('news-analysis consumer pattern (result.similarity * 100)', () => {
    it('produces a valid percentage on rerank success results (no NaN, not negative)', async () => {
      const reranked = [{ ...BASE_FUSED, rerankScore: 2.4, fallbackReason: null }];
      const svc = await buildMultiStageService({
        plannerResult: { rewrittenQuery: 'q', rerankQuery: 'q', lanes: ['dense'], topKPerLane: 20 },
        fused: [BASE_FUSED],
        reranked,
        packed: [{ chunkId: 'c1', sourceId: 'src-1', content: 'fused content', metadata: {} }],
      });

      const results = await svc.search('q', 5);
      const pct = results[0]!.similarity * 100;
      expect(Number.isNaN(pct)).toBe(false);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
      // Should also be printable via toFixed without blowing up
      expect(`${pct.toFixed(1)}%`).toMatch(/^\d+\.\d%$/);
    });

    it('produces a valid percentage on RRF fallback results', async () => {
      const reranked = [
        { ...BASE_FUSED, rerankScore: 0.08, fallbackReason: 'rerank_unavailable' as const },
      ];
      const svc = await buildMultiStageService({
        plannerResult: { rewrittenQuery: 'q', rerankQuery: 'q', lanes: ['dense'], topKPerLane: 20 },
        fused: [BASE_FUSED],
        reranked,
        packed: [{ chunkId: 'c1', sourceId: 'src-1', content: 'fused content', metadata: {} }],
      });

      const results = await svc.search('q', 5);
      const pct = results[0]!.similarity * 100;
      expect(Number.isNaN(pct)).toBe(false);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    });
  });
});
