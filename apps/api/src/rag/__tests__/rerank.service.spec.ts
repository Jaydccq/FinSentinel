import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RerankService } from '../rerank.service';
import type { FusedCandidate } from '../retrieval-fusion.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeConfigService(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string, defaultVal: unknown) => {
      if (key in overrides) return overrides[key];
      if (key === 'RERANKER_URL') return 'http://localhost:8100';
      if (key === 'RERANKER_TIMEOUT_MS') return 5000;
      if (key === 'RAG_RERANK_MAX_TOKENS') return 480;
      return defaultVal;
    }),
  };
}

function makeCandidate(partial: Partial<FusedCandidate> & { chunkId: string }): FusedCandidate {
  return {
    sourceId: 's1',
    content: 'chunk content',
    metadata: {},
    rrfScore: 0.05,
    lanes: ['dense'],
    representationTypesSeen: [],
    variantKindsSeen: [],
    ...partial,
  };
}

function makeMetrics() {
  return { incrementCounter: vi.fn() as Mock };
}

describe('RerankService — preamble construction', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('prepends [Title] and [Section] when both are present in metadata', async () => {
    const metrics = makeMetrics();
    const service = new RerankService(makeConfigService() as any, metrics as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'c1', score: 0.9, rank: 1 }] }),
    });

    const candidate = makeCandidate({
      chunkId: 'c1',
      metadata: { meta_title: 'Annual Report', section_path: '2.3 FX' },
    });

    await service.rerank('query', [candidate], 5);

    const body = JSON.parse((mockFetch.mock.calls[0] as any)[1].body);
    expect(body.candidates[0].text).toBe('[Title: Annual Report] [Section: 2.3 FX]\nchunk content');
  });

  it('omits [Title] segment when meta_title is absent', async () => {
    const metrics = makeMetrics();
    const service = new RerankService(makeConfigService() as any, metrics as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'c1', score: 0.9, rank: 1 }] }),
    });

    const candidate = makeCandidate({
      chunkId: 'c1',
      metadata: { section_path: '2.3 FX' },
    });

    await service.rerank('query', [candidate], 5);

    const body = JSON.parse((mockFetch.mock.calls[0] as any)[1].body);
    expect(body.candidates[0].text).toBe('[Section: 2.3 FX]\nchunk content');
  });

  it('sends raw chunk text when both meta_title and section_path are absent', async () => {
    const metrics = makeMetrics();
    const service = new RerankService(makeConfigService() as any, metrics as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'c1', score: 0.9, rank: 1 }] }),
    });

    const candidate = makeCandidate({ chunkId: 'c1', metadata: {} });

    await service.rerank('query', [candidate], 5);

    const body = JSON.parse((mockFetch.mock.calls[0] as any)[1].body);
    expect(body.candidates[0].text).toBe('chunk content');
  });
});

describe('RerankService — token budget', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('drops preamble and increments counter when preamble+chunk exceeds budget', async () => {
    const metrics = makeMetrics();
    // Budget: 10 tokens = 40 chars
    const service = new RerankService(
      makeConfigService({ RAG_RERANK_MAX_TOKENS: 10 }) as any,
      metrics as any,
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'c1', score: 0.9, rank: 1 }] }),
    });

    const longContent = 'A'.repeat(20); // 20 chars = 5 tokens — fits alone
    const candidate = makeCandidate({
      chunkId: 'c1',
      metadata: { meta_title: 'Title', section_path: 'Sec' },
      content: longContent,
    });

    await service.rerank('query', [candidate], 5);

    const body = JSON.parse((mockFetch.mock.calls[0] as any)[1].body);
    // Preamble was dropped, raw chunk sent
    expect(body.candidates[0].text).toBe(longContent);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_preamble_dropped_total',
      expect.any(String),
      {},
    );
  });

  it('truncates chunk from end with "..." when chunk alone exceeds budget', async () => {
    const metrics = makeMetrics();
    // Budget: 5 tokens = 20 chars
    const service = new RerankService(
      makeConfigService({ RAG_RERANK_MAX_TOKENS: 5 }) as any,
      metrics as any,
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'c1', score: 0.9, rank: 1 }] }),
    });

    const longContent = 'B'.repeat(100);
    const candidate = makeCandidate({ chunkId: 'c1', metadata: {}, content: longContent });

    await service.rerank('query', [candidate], 5);

    const body = JSON.parse((mockFetch.mock.calls[0] as any)[1].body);
    const sent: string = body.candidates[0].text;
    // Must end with '...'
    expect(sent.endsWith('...')).toBe(true);
    // Must not be longer than budget * 4 chars
    expect(sent.length).toBeLessThanOrEqual(5 * 4);
    // Original start preserved
    expect(sent.startsWith('B')).toBe(true);
  });
});

describe('RerankService — response validation', () => {
  let service: RerankService;
  let metrics: ReturnType<typeof makeMetrics>;

  beforeEach(() => {
    mockFetch.mockReset();
    metrics = makeMetrics();
    service = new RerankService(makeConfigService() as any, metrics as any);
  });

  it('returns fallbackReason: null on a valid response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'c1', score: 0.9, rank: 1 }] }),
    });

    const candidate = makeCandidate({ chunkId: 'c1' });
    const result = await service.rerank('q', [candidate], 5);

    expect(result[0]!.fallbackReason).toBeNull();
    expect(result[0]!.rerankScore).toBe(0.9);
  });

  it('triggers RRF fallback and rerank_malformed flag on 200 OK with malformed body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ wrong_field: 42 }),
    });

    const candidates = [
      makeCandidate({ chunkId: 'c1', rrfScore: 0.08 }),
      makeCandidate({ chunkId: 'c2', rrfScore: 0.04, sourceId: 's2' }),
    ];
    const result = await service.rerank('q', candidates, 5);

    expect(result[0]!.fallbackReason).toBe('rerank_malformed');
    expect(result[0]!.rerankScore).toBe(0.08); // RRF score used
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_malformed_total',
      expect.any(String),
      {},
    );
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_fallback_total',
      expect.any(String),
      { reason: 'rerank_malformed' },
    );
  });

  it('triggers RRF fallback and rerank_unavailable flag on 200 OK with invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });

    const candidate = makeCandidate({ chunkId: 'c1', rrfScore: 0.03 });
    const result = await service.rerank('q', [candidate], 5);

    expect(result[0]!.fallbackReason).toBe('rerank_malformed');
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_malformed_total',
      expect.any(String),
      {},
    );
  });

  it('triggers RRF fallback and rerank_unavailable flag on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const candidate = makeCandidate({ chunkId: 'c1', rrfScore: 0.02 });
    const result = await service.rerank('q', [candidate], 5);

    expect(result[0]!.fallbackReason).toBe('rerank_unavailable');
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_fallback_total',
      expect.any(String),
      { reason: 'rerank_unavailable' },
    );
  });

  it('triggers RRF fallback and rerank_unavailable flag on network timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const candidate = makeCandidate({ chunkId: 'c1', rrfScore: 0.01 });
    const result = await service.rerank('q', [candidate], 5);

    expect(result[0]!.fallbackReason).toBe('rerank_unavailable');
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_fallback_total',
      expect.any(String),
      { reason: 'rerank_unavailable' },
    );
  });
});

describe('RerankService — partial result top-up from RRF', () => {
  let service: RerankService;
  let metrics: ReturnType<typeof makeMetrics>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    metrics = makeMetrics();
    service = new RerankService(makeConfigService() as any, metrics as any);
    // Silence and observe the WARN log channel from the Logger instance.
    warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  it('does not top-up or warn when sidecar returns exactly topK results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { id: 'c1', score: 0.9, rank: 1 },
          { id: 'c2', score: 0.8, rank: 2 },
          { id: 'c3', score: 0.7, rank: 3 },
        ],
      }),
    });

    const candidates = [
      makeCandidate({ chunkId: 'c1', rrfScore: 0.09 }),
      makeCandidate({ chunkId: 'c2', rrfScore: 0.08 }),
      makeCandidate({ chunkId: 'c3', rrfScore: 0.07 }),
      makeCandidate({ chunkId: 'c4', rrfScore: 0.06 }),
    ];

    const result = await service.rerank('q', candidates, 3);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.chunkId)).toEqual(['c1', 'c2', 'c3']);
    expect(result.every((r) => r.fallbackReason === null)).toBe(true);
    // No partial-topup warn or counter
    expect(warnSpy).not.toHaveBeenCalled();
    expect(metrics.incrementCounter).not.toHaveBeenCalledWith(
      'rag_rerank_partial_topup_total',
      expect.any(String),
      expect.anything(),
    );
  });

  it('falls back fully to RRF when sidecar returns 0 valid candidates', async () => {
    // Empty results → sidecarPrefix is empty → fillers grab top RRF picks.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const candidates = [
      makeCandidate({ chunkId: 'c1', rrfScore: 0.05 }),
      makeCandidate({ chunkId: 'c2', rrfScore: 0.09 }),
      makeCandidate({ chunkId: 'c3', rrfScore: 0.07 }),
    ];

    const result = await service.rerank('q', candidates, 3);

    expect(result).toHaveLength(3);
    // RRF-ordered: c2 (0.09) > c3 (0.07) > c1 (0.05)
    expect(result.map((r) => r.chunkId)).toEqual(['c2', 'c3', 'c1']);
    expect(result.map((r) => r.rerankScore)).toEqual([0.09, 0.07, 0.05]);
    // Partial-topup path is taken (sidecarPrefix=0 < topK=3)
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_partial_topup_total',
      expect.any(String),
      {},
    );
  });

  it('fills the tail with RRF-ordered candidates when sidecar returns half of topK', async () => {
    // topK=4, sidecar returns 2 → fill 2 more from RRF.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { id: 'c1', score: 0.95, rank: 1 },
          { id: 'c3', score: 0.85, rank: 2 },
        ],
      }),
    });

    const candidates = [
      makeCandidate({ chunkId: 'c1', rrfScore: 0.04 }),
      makeCandidate({ chunkId: 'c2', rrfScore: 0.08 }),
      makeCandidate({ chunkId: 'c3', rrfScore: 0.06 }),
      makeCandidate({ chunkId: 'c4', rrfScore: 0.07 }),
      makeCandidate({ chunkId: 'c5', rrfScore: 0.03 }),
    ];

    const result = await service.rerank('q', candidates, 4);

    expect(result).toHaveLength(4);
    // sidecar prefix preserved in order: c1, c3
    // remaining RRF order excluding c1,c3: c2 (0.08), c4 (0.07), c5 (0.03) → take c2, c4
    expect(result.map((r) => r.chunkId)).toEqual(['c1', 'c3', 'c2', 'c4']);
    // Sidecar entries keep sidecar score; fillers keep their RRF score.
    expect(result[0]!.rerankScore).toBe(0.95);
    expect(result[1]!.rerankScore).toBe(0.85);
    expect(result[2]!.rerankScore).toBe(0.08);
    expect(result[3]!.rerankScore).toBe(0.07);
    // No duplicates
    expect(new Set(result.map((r) => r.chunkId)).size).toBe(4);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_partial_topup_total',
      expect.any(String),
      {},
    );
  });

  it('dedupes: a doc appearing in both sidecar and RRF appears only once (sidecar position wins)', async () => {
    // c1 has lowest RRF but is sidecar's #1 — must stay first, RRF must not
    // re-add it later.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ id: 'c1', score: 0.99, rank: 1 }],
      }),
    });

    const candidates = [
      makeCandidate({ chunkId: 'c1', rrfScore: 0.01 }),
      makeCandidate({ chunkId: 'c2', rrfScore: 0.09 }),
      makeCandidate({ chunkId: 'c3', rrfScore: 0.08 }),
    ];

    const result = await service.rerank('q', candidates, 3);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.chunkId)).toEqual(['c1', 'c2', 'c3']);
    expect(result[0]!.rerankScore).toBe(0.99); // sidecar score, not RRF
    expect(new Set(result.map((r) => r.chunkId)).size).toBe(3);
  });

  it('returns whatever is available without invention when RRF input is smaller than topK', async () => {
    // topK=5, sidecar returns 1, RRF has only 2 unique remaining → final size=3.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ id: 'c1', score: 0.9, rank: 1 }],
      }),
    });

    const candidates = [
      makeCandidate({ chunkId: 'c1', rrfScore: 0.05 }),
      makeCandidate({ chunkId: 'c2', rrfScore: 0.04 }),
      makeCandidate({ chunkId: 'c3', rrfScore: 0.03 }),
    ];

    const result = await service.rerank('q', candidates, 5);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.chunkId)).toEqual(['c1', 'c2', 'c3']);
    // Warn fires because sidecar (1) < topK (5)
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'rag_rerank_partial_topup_total',
      expect.any(String),
      {},
    );
  });
});

describe('RerankService — backwards compatibility (no metrics)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('works without a metrics service injected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'c1', score: 0.85, rank: 1 }] }),
    });

    const service = new RerankService(makeConfigService() as any);
    const candidate = makeCandidate({ chunkId: 'c1' });
    const result = await service.rerank('q', [candidate], 5);

    expect(result[0]!.rerankScore).toBe(0.85);
  });
});
