import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService, type RagSearchOptions } from '../rag-retrieval.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { RagChunkStoreService } from '../rag-chunk-store.service';
import { MetricsService } from '../../common/services/metrics.service';
import { RerankService } from '../rerank.service';
import { ContextPackerService } from '../context-packer.service';
import { RetrievalPlannerService } from '../retrieval-planner.service';
import { RetrievalOrchestratorService } from '../retrieval-orchestrator.service';
import { RagTraceService } from '../rag-trace.service';
import { RolloutGateService } from '../rollout-gate.service';
import { ShadowRunnerService, type ShadowOutcome } from '../shadow-runner.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSingleStageChunk(id = 'ss-chunk-1') {
  return {
    id,
    sourceType: 'document',
    sourceId: 'doc-1',
    chunkIndex: 0,
    content: 'single stage content',
    embedding: [1, 0],
    metadata: {},
    similarity: 0.8,
  };
}

function makeFusedCandidate(chunkId = 'ms-chunk-1') {
  return {
    chunkId,
    sourceId: 'src-1',
    content: 'multi stage content',
    metadata: {},
    rrfScore: 0.05,
    lanes: ['dense'],
    representationTypesSeen: ['canonical'],
    variantKindsSeen: ['original'],
  };
}

function makeMultiStageMocks(chunkId = 'ms-chunk-1') {
  const fusedCandidate = makeFusedCandidate(chunkId);
  const rerankedCandidate = { ...fusedCandidate, rerankScore: 0.9, fallbackReason: null };

  const mockPlanner = {
    plan: vi.fn().mockResolvedValue({
      rewrittenQuery: 'test query',
      rerankQuery: 'test query',
      queryClass: 'factoid',
      variants: [],
      lanes: ['dense'],
      topKPerLane: 20,
      fallbackFlags: [],
    }),
  };
  const mockOrchestrator = {
    orchestrate: vi.fn().mockResolvedValue({ fused: [fusedCandidate], laneCounts: { dense: 1 } }),
  };
  const mockReranker = {
    rerank: vi.fn().mockResolvedValue([rerankedCandidate]),
  };
  const mockPacker = {
    pack: vi.fn().mockReturnValue({
      chunks: [{ chunkId, sourceId: 'src-1', content: 'multi stage content', metadata: {} }],
      totalTokenEstimate: 10,
    }),
  };

  return { mockPlanner, mockOrchestrator, mockReranker, mockPacker };
}

function makeConfigGet(overrides: Record<string, unknown> = {}) {
  return (key: string, defaultVal: unknown) => {
    if (key in overrides) return overrides[key];
    if (key === 'RAG_SIMILARITY_THRESHOLD') return 0.65;
    return defaultVal;
  };
}

// ---------------------------------------------------------------------------
// Shadow mode tests
// ---------------------------------------------------------------------------

describe('RagRetrievalService shadow mode (R7.3)', () => {
  it('returns single-stage result even when multi-stage throws inside shadow', async () => {
    const { mockPlanner, mockOrchestrator, mockReranker, mockPacker } = makeMultiStageMocks();

    // Make BOTH the planner AND the fallback embedding fail so searchMultiStage
    // cannot recover internally — this causes the error to surface out of
    // searchMultiStage entirely, reaching runShadow's try/catch.
    mockPlanner.plan.mockRejectedValue(new Error('multi stage explosion'));

    const mockEmbedding = {
      // First call: single-stage (primary) — succeeds
      // Subsequent calls: shadow's dense-fallback inside searchMultiStage — also fails
      embedQuery: vi.fn()
        .mockResolvedValueOnce([1, 0])  // single-stage primary call
        .mockRejectedValue(new Error('embed also fails in shadow')),
    };

    const mockTrace = {
      recordTrace: vi.fn().mockResolvedValue(undefined),
      recordShadowComparison: vi.fn().mockResolvedValue(undefined),
    };

    // ShadowRunnerService that actually executes the task inline.
    const mockShadowRunner = {
      enqueue: vi.fn().mockImplementation(async (task: () => Promise<unknown>) => {
        try {
          await task();
        } catch {
          // swallow — the task itself records the comparison row
        }
        return 'executed' as ShadowOutcome;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: mockEmbedding },
        { provide: RagChunkStoreService, useValue: { search: vi.fn().mockResolvedValue([makeSingleStageChunk()]) } },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: makeConfigGet({
              'RAG_MULTI_STAGE_ENABLED': 'true',
              'rag.rollout.mode': 'shadow',
              'rag.rollout.shadowSampleRate': 1.0,
            }),
          },
        },
        { provide: RetrievalPlannerService, useValue: mockPlanner },
        { provide: RetrievalOrchestratorService, useValue: mockOrchestrator },
        { provide: RerankService, useValue: mockReranker },
        { provide: ContextPackerService, useValue: mockPacker },
        { provide: RagTraceService, useValue: mockTrace },
        { provide: ShadowRunnerService, useValue: mockShadowRunner },
      ],
    }).compile();

    const svc = module.get(RagRetrievalService);
    const results = await svc.search({ query: 'test query', queryClass: 'factoid' } as RagSearchOptions);

    // User gets single-stage results — no 5xx propagated
    expect(results).toHaveLength(1);
    expect(results[0]!.chunkId).toBe('ss-chunk-1');

    // Flush the microtask/task queue so the fire-and-forget shadow promise resolves.
    // The shadow chain has several awaits (enqueue → task → searchMultiStage throw
    // → recordShadowComparison), so we drain with a setImmediate tick which runs
    // after all pending microtasks.
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Shadow ran and recorded a comparison row with multiStageError set
    expect(mockTrace.recordShadowComparison).toHaveBeenCalledOnce();
    const arg = (mockTrace.recordShadowComparison as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg['multiStageError']).not.toBeNull();
    expect(typeof arg['multiStageError']).toBe('string');
    // Single-stage chunks populated
    expect(arg['singleStageChunkIds']).toEqual(['ss-chunk-1']);
  });

  it('records shadow_timed_out row when shadow runner times out', async () => {
    const { mockPlanner, mockOrchestrator, mockReranker, mockPacker } = makeMultiStageMocks();

    const mockTrace = {
      recordTrace: vi.fn().mockResolvedValue(undefined),
      recordShadowComparison: vi.fn().mockResolvedValue(undefined),
    };

    // ShadowRunnerService that simulates a timeout (does not run the task)
    const mockShadowRunner = {
      enqueue: vi.fn().mockResolvedValue('timed_out' as ShadowOutcome),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: { embedQuery: vi.fn().mockResolvedValue([1, 0]) } },
        { provide: RagChunkStoreService, useValue: { search: vi.fn().mockResolvedValue([makeSingleStageChunk()]) } },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: makeConfigGet({
              'RAG_MULTI_STAGE_ENABLED': 'true',
              'rag.rollout.mode': 'shadow',
              'rag.rollout.shadowSampleRate': 1.0,
            }),
          },
        },
        { provide: RetrievalPlannerService, useValue: mockPlanner },
        { provide: RetrievalOrchestratorService, useValue: mockOrchestrator },
        { provide: RerankService, useValue: mockReranker },
        { provide: ContextPackerService, useValue: mockPacker },
        { provide: RagTraceService, useValue: mockTrace },
        { provide: ShadowRunnerService, useValue: mockShadowRunner },
      ],
    }).compile();

    const svc = module.get(RagRetrievalService);
    const results = await svc.search({ query: 'test query' } as RagSearchOptions);

    expect(results).toHaveLength(1);

    // Stub row must be written for timed_out
    expect(mockTrace.recordShadowComparison).toHaveBeenCalledOnce();
    const arg = (mockTrace.recordShadowComparison as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg['shadowTimedOut']).toBe(true);
    expect(arg['shadowDroppedBackpressure']).toBe(false);
    expect(arg['multiStageError']).toBe('timed_out');
  });

  it('persists shadow_dropped_backpressure row when queue is full', async () => {
    const { mockPlanner, mockOrchestrator, mockReranker, mockPacker } = makeMultiStageMocks();

    const mockTrace = {
      recordTrace: vi.fn().mockResolvedValue(undefined),
      recordShadowComparison: vi.fn().mockResolvedValue(undefined),
    };

    const mockShadowRunner = {
      enqueue: vi.fn().mockResolvedValue('dropped_backpressure' as ShadowOutcome),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: { embedQuery: vi.fn().mockResolvedValue([1, 0]) } },
        { provide: RagChunkStoreService, useValue: { search: vi.fn().mockResolvedValue([makeSingleStageChunk()]) } },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: makeConfigGet({
              'RAG_MULTI_STAGE_ENABLED': 'true',
              'rag.rollout.mode': 'shadow',
              'rag.rollout.shadowSampleRate': 1.0,
            }),
          },
        },
        { provide: RetrievalPlannerService, useValue: mockPlanner },
        { provide: RetrievalOrchestratorService, useValue: mockOrchestrator },
        { provide: RerankService, useValue: mockReranker },
        { provide: ContextPackerService, useValue: mockPacker },
        { provide: RagTraceService, useValue: mockTrace },
        { provide: ShadowRunnerService, useValue: mockShadowRunner },
      ],
    }).compile();

    const svc = module.get(RagRetrievalService);
    await svc.search({ query: 'test query' } as RagSearchOptions);

    expect(mockTrace.recordShadowComparison).toHaveBeenCalledOnce();
    const arg = (mockTrace.recordShadowComparison as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(arg['shadowDroppedBackpressure']).toBe(true);
    expect(arg['shadowTimedOut']).toBe(false);
    expect(arg['multiStageError']).toBe('dropped_backpressure');
    expect(arg['multiStageChunkIds']).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Canary mode tests
// ---------------------------------------------------------------------------

describe('RagRetrievalService canary mode (R7.3)', () => {
  it('routes to multi_stage when gate picks multi_stage', async () => {
    const { mockPlanner, mockOrchestrator, mockReranker, mockPacker } = makeMultiStageMocks('ms-chunk-1');

    const mockGate = {
      decide: vi.fn().mockReturnValue({
        pipeline: 'multi_stage',
        stickinessSource: 'user_id',
        auth: 'user',
        effectivePercent: 100,
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: { embedQuery: vi.fn().mockResolvedValue([1, 0]) } },
        { provide: RagChunkStoreService, useValue: { search: vi.fn().mockResolvedValue([makeSingleStageChunk()]) } },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: makeConfigGet({
              'RAG_MULTI_STAGE_ENABLED': 'true',
              'rag.rollout.mode': 'canary',
            }),
          },
        },
        { provide: RetrievalPlannerService, useValue: mockPlanner },
        { provide: RetrievalOrchestratorService, useValue: mockOrchestrator },
        { provide: RerankService, useValue: mockReranker },
        { provide: ContextPackerService, useValue: mockPacker },
        { provide: RolloutGateService, useValue: mockGate },
      ],
    }).compile();

    const svc = module.get(RagRetrievalService);
    const results = await svc.search({
      query: 'test query',
      queryClass: 'exact_lookup',
      stickiness: { userId: 'u1' },
    } as RagSearchOptions);

    // Multi-stage path was taken
    expect(mockPlanner.plan).toHaveBeenCalledOnce();
    expect(mockReranker.rerank).toHaveBeenCalledOnce();
    expect(results[0]!.chunkId).toBe('ms-chunk-1');
  });

  it('routes to single_stage when gate picks single_stage', async () => {
    const { mockPlanner, mockOrchestrator, mockReranker, mockPacker } = makeMultiStageMocks();

    const mockGate = {
      decide: vi.fn().mockReturnValue({
        pipeline: 'single_stage',
        stickinessSource: 'ip',
        auth: 'anon',
        effectivePercent: 10,
      }),
    };

    const mockChunkStore = {
      search: vi.fn().mockResolvedValue([makeSingleStageChunk()]),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: RagEmbeddingService, useValue: { embedQuery: vi.fn().mockResolvedValue([1, 0]) } },
        { provide: RagChunkStoreService, useValue: mockChunkStore },
        {
          provide: MetricsService,
          useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: makeConfigGet({
              'RAG_MULTI_STAGE_ENABLED': 'true',
              'rag.rollout.mode': 'canary',
            }),
          },
        },
        { provide: RetrievalPlannerService, useValue: mockPlanner },
        { provide: RetrievalOrchestratorService, useValue: mockOrchestrator },
        { provide: RerankService, useValue: mockReranker },
        { provide: ContextPackerService, useValue: mockPacker },
        { provide: RolloutGateService, useValue: mockGate },
      ],
    }).compile();

    const svc = module.get(RagRetrievalService);
    const results = await svc.search({
      query: 'test query',
      queryClass: 'factoid',
      stickiness: { ipAddress: '1.2.3.4' },
    } as RagSearchOptions);

    // Single-stage path taken — multi-stage NOT invoked
    expect(mockPlanner.plan).not.toHaveBeenCalled();
    expect(mockReranker.rerank).not.toHaveBeenCalled();
    expect(results[0]!.chunkId).toBe('ss-chunk-1');
    expect(mockChunkStore.search).toHaveBeenCalledOnce();
  });
});
