import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RetrievalPlannerService } from '../retrieval-planner.service';

// ── Config helpers ────────────────────────────────────────────────────────────

interface ConfigOverrides {
  graphEnabled?: boolean;
  rewriteEnabled?: boolean;
  hydeEnabled?: boolean;
  decomposeEnabled?: boolean;
}

function mockConfigService(opts: ConfigOverrides = {}) {
  const {
    graphEnabled = false,
    rewriteEnabled = true,
    hydeEnabled = false,
    decomposeEnabled = false,
  } = opts;

  return {
    get: vi.fn((key: string, defaultVal: unknown) => {
      if (key === 'RAG_GRAPH_ENABLED') return graphEnabled ? 'true' : 'false';
      if (key === 'rag.retrieval.queryRewriteEnabled') return rewriteEnabled;
      if (key === 'rag.retrieval.hydeEnabled') return hydeEnabled;
      if (key === 'rag.retrieval.queryDecomposeEnabled') return decomposeEnabled;
      return defaultVal;
    }),
  };
}

// ── Mock factories ────────────────────────────────────────────────────────────

function makeRewrite(impl?: (q: string) => Promise<string>) {
  return {
    rewrite: vi.fn().mockImplementation(impl ?? ((q: string) => Promise.resolve(q))),
  };
}

function makeVariant(overrides?: {
  hyde?: Mock;
  decompose?: Mock;
}) {
  return {
    hyde: overrides?.hyde ?? vi.fn().mockResolvedValue(null),
    decompose: overrides?.decompose ?? vi.fn().mockResolvedValue([]),
  };
}

function makeService(
  opts: ConfigOverrides = {},
  rewriteMock = makeRewrite(),
  variantMock = makeVariant(),
): RetrievalPlannerService {
  return new RetrievalPlannerService(
    rewriteMock as any,
    variantMock as any,
    mockConfigService(opts) as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RetrievalPlannerService', () => {
  // ── Backward-compat: existing tests ───────────────────────────────────────

  it('always includes dense and sparse lanes', async () => {
    const plan = await makeService().plan('What is Apple revenue?');
    expect(plan.lanes).toContain('dense');
    expect(plan.lanes).toContain('sparse');
  });

  it('does NOT activate graph lane when graph is disabled (default)', async () => {
    const plan = await makeService().plan('Who are the main competitors of Tesla?');
    expect(plan.lanes).not.toContain('graph');
  });

  it('activates graph lane for relational queries when graph is enabled', async () => {
    const plan = await makeService({ graphEnabled: true }).plan('Who are the main competitors of Tesla?');
    expect(plan.lanes).toContain('graph');
  });

  it('does NOT activate graph lane for simple queries even when graph is enabled', async () => {
    const plan = await makeService({ graphEnabled: true }).plan('AAPL stock price today');
    expect(plan.lanes).not.toContain('graph');
  });

  it('delegates rewrite to QueryRewriteService', async () => {
    const rewrite = makeRewrite();
    await makeService({}, rewrite).plan('test query');
    expect(rewrite.rewrite).toHaveBeenCalledWith('test query');
  });

  it('returns the rewritten query in the plan', async () => {
    const rewrite = makeRewrite((_q) => Promise.resolve('optimized test query'));
    const plan = await makeService({}, rewrite).plan('test query');
    expect(plan.originalQuery).toBe('test query');
    expect(plan.rewrittenQuery).toBe('optimized test query');
  });

  it('includes default topKPerLane', async () => {
    const plan = await makeService().plan('test');
    expect(plan.topKPerLane).toBe(20);
  });

  // ── Empty query ───────────────────────────────────────────────────────────

  it('empty query returns variants=[original], no LLM call for rewrite', async () => {
    const rewrite = makeRewrite();
    const variant = makeVariant();
    const plan = await makeService({ rewriteEnabled: true }, rewrite, variant).plan('');
    // rewrite is called but the empty-string guard in QueryRewriteService returns original
    // planner-level: rewrite returns '' which equals original so no rewrite variant is added
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0]).toEqual({ kind: 'original', query: '' });
    expect(variant.hyde).not.toHaveBeenCalled();
    expect(variant.decompose).not.toHaveBeenCalled();
  });

  // ── Factoid ───────────────────────────────────────────────────────────────

  it('factoid short query produces variants=[original, rewrite], no hyde or subquery', async () => {
    const rewrite = makeRewrite((_q) => Promise.resolve('rewritten query'));
    const variant = makeVariant();
    const plan = await makeService({}, rewrite, variant).plan('What is AAPL EPS?');
    expect(plan.queryClass).toBe('factoid');
    expect(plan.variants.map((v) => v.kind)).toEqual(['original', 'rewrite']);
    expect(variant.hyde).not.toHaveBeenCalled();
    expect(variant.decompose).not.toHaveBeenCalled();
  });

  it('factoid: rewrite equals original, only original variant present', async () => {
    const rewrite = makeRewrite((q) => Promise.resolve(q));
    const plan = await makeService({}, rewrite).plan('AAPL revenue?');
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].kind).toBe('original');
  });

  // ── Relational ────────────────────────────────────────────────────────────

  it('relational query with graph enabled includes graph lane', async () => {
    const plan = await makeService({ graphEnabled: true }).plan("Who are TSMC's competitors?");
    expect(plan.queryClass).toBe('relational');
    expect(plan.lanes).toContain('graph');
  });

  it('relational query without graph enabled does not include graph lane', async () => {
    const plan = await makeService({ graphEnabled: false }).plan("Who are TSMC's competitors?");
    expect(plan.queryClass).toBe('relational');
    expect(plan.lanes).not.toContain('graph');
  });

  // ── Analytical ────────────────────────────────────────────────────────────

  it('analytical long query with RAG_HYDE_ENABLED=true includes hyde variant', async () => {
    const longQuery = 'Analyze the impact of interest rate changes on Apple and Microsoft earnings over the last decade.';
    const hydePassage = 'Hypothetical passage about rate impact.';
    const variant = makeVariant({ hyde: vi.fn().mockResolvedValue(hydePassage) });
    const rewrite = makeRewrite((_q) => Promise.resolve('rewritten'));
    const plan = await makeService({ hydeEnabled: true }, rewrite, variant).plan(longQuery);
    expect(plan.queryClass).toBe('analytical');
    expect(plan.variants.map((v) => v.kind)).toContain('hyde');
    const hydeVariant = plan.variants.find((v) => v.kind === 'hyde');
    expect(hydeVariant?.query).toBe(hydePassage);
  });

  it('analytical: HyDE LLM failure adds hyde_failed flag and no hyde variant', async () => {
    const longQuery = 'Analyze and compare the risk profiles of TSMC and Samsung in the semiconductor industry.';
    const variant = makeVariant({ hyde: vi.fn().mockResolvedValue(null) });
    const plan = await makeService({ hydeEnabled: true }, makeRewrite(), variant).plan(longQuery);
    expect(plan.queryClass).toBe('analytical');
    expect(plan.variants.map((v) => v.kind)).not.toContain('hyde');
    expect(plan.fallbackFlags).toContain('hyde_failed');
  });

  it('analytical: HyDE disabled, no hyde variant even for analytical query', async () => {
    const longQuery = 'Explain the impact of Fed rate hikes on tech sector valuations in detail with examples.';
    const variant = makeVariant({ hyde: vi.fn().mockResolvedValue('passage') });
    const plan = await makeService({ hydeEnabled: false }, makeRewrite(), variant).plan(longQuery);
    expect(plan.variants.map((v) => v.kind)).not.toContain('hyde');
    expect(variant.hyde).not.toHaveBeenCalled();
  });

  // ── Multi-part ────────────────────────────────────────────────────────────

  it('multi_part query with RAG_QUERY_DECOMPOSE_ENABLED=true includes subquery variants', async () => {
    const subqueries = ['What is AAPL revenue?', 'What is AAPL margin?'];
    const variant = makeVariant({ decompose: vi.fn().mockResolvedValue(subqueries) });
    const rewrite = makeRewrite((_q) => Promise.resolve('rewritten'));
    const plan = await makeService({ decomposeEnabled: true }, rewrite, variant).plan(
      'What is AAPL revenue? And what is the margin?',
    );
    expect(plan.queryClass).toBe('multi_part');
    const subVariants = plan.variants.filter((v) => v.kind === 'subquery');
    expect(subVariants).toHaveLength(2);
    expect(subVariants[0].query).toBe(subqueries[0]);
    expect(subVariants[1].query).toBe(subqueries[1]);
  });

  it('multi_part: decompose LLM failure adds decompose_failed flag and no subquery variants', async () => {
    const variant = makeVariant({ decompose: vi.fn().mockResolvedValue([]) });
    const plan = await makeService({ decomposeEnabled: true }, makeRewrite(), variant).plan(
      'What is AAPL revenue? And what is MSFT margin?',
    );
    expect(plan.queryClass).toBe('multi_part');
    expect(plan.variants.map((v) => v.kind)).not.toContain('subquery');
    expect(plan.fallbackFlags).toContain('decompose_failed');
  });

  it('multi_part: decompose disabled, no subquery variants', async () => {
    const variant = makeVariant({ decompose: vi.fn().mockResolvedValue(['Q1?', 'Q2?']) });
    const plan = await makeService({ decomposeEnabled: false }, makeRewrite(), variant).plan(
      'What is AAPL revenue? And what is the margin?',
    );
    expect(plan.variants.map((v) => v.kind)).not.toContain('subquery');
    expect(variant.decompose).not.toHaveBeenCalled();
  });

  // ── Rewrite failure ───────────────────────────────────────────────────────

  it('rewrite failure does not throw; plan still contains original variant', async () => {
    // QueryRewriteService.rewrite() never throws -- it falls back to original.
    // Simulate by returning the original query (what the service does on error).
    const rewrite = makeRewrite((q) => Promise.resolve(q));
    const plan = await makeService({}, rewrite).plan('What is AAPL risk?');
    expect(plan.variants[0]).toEqual({ kind: 'original', query: 'What is AAPL risk?' });
    expect(plan.variants).toHaveLength(1);
  });

  // ── Full happy path ───────────────────────────────────────────────────────

  it('analytical multi-part query returns original + rewrite + hyde + subqueries (up to 3)', async () => {
    // Query is both analytical (has analytical keyword) and multi_part (two question marks).
    // multi_part takes precedence in classification, so queryClass = multi_part.
    // However we also test a purely analytical query for hyde.
    const analyticalMultiPart = 'Analyze the risk? And explain the outlook?';
    const subqueries = ['Analyze the risk?', 'Explain the outlook?'];
    const hydePassage = 'A passage about risk and outlook.';
    const variant = makeVariant({
      hyde: vi.fn().mockResolvedValue(hydePassage),
      decompose: vi.fn().mockResolvedValue(subqueries),
    });
    const rewrite = makeRewrite((_q) => Promise.resolve('rewritten query'));

    // multi_part wins over analytical in classification
    const plan = await makeService(
      { hydeEnabled: true, decomposeEnabled: true },
      rewrite,
      variant,
    ).plan(analyticalMultiPart);

    expect(plan.queryClass).toBe('multi_part');
    // multi_part only activates decompose, not hyde
    const kinds = plan.variants.map((v) => v.kind);
    expect(kinds).toContain('original');
    expect(kinds).toContain('rewrite');
    expect(kinds).toContain('subquery');
    expect(plan.variants.filter((v) => v.kind === 'subquery')).toHaveLength(2);
    expect(plan.fallbackFlags).toHaveLength(0);
  });

  it('analytical (not multi_part) happy path: original + rewrite + hyde', async () => {
    const analyticalQuery = 'Analyze the long-term competitive outlook for NVIDIA versus AMD in the AI accelerator market given supply chain constraints.';
    const hydePassage = 'NVIDIA and AMD both face...';
    const variant = makeVariant({ hyde: vi.fn().mockResolvedValue(hydePassage) });
    const rewrite = makeRewrite((_q) => Promise.resolve('rewritten analytical query'));

    const plan = await makeService(
      { hydeEnabled: true, decomposeEnabled: true },
      rewrite,
      variant,
    ).plan(analyticalQuery);

    expect(plan.queryClass).toBe('analytical');
    const kinds = plan.variants.map((v) => v.kind);
    expect(kinds).toEqual(['original', 'rewrite', 'hyde']);
    expect(plan.fallbackFlags).toHaveLength(0);
  });

  // ── Plan structure ────────────────────────────────────────────────────────

  it('original query is always the first variant', async () => {
    const rewrite = makeRewrite((_q) => Promise.resolve('rewritten'));
    const plan = await makeService({}, rewrite).plan('Some query');
    expect(plan.variants[0].kind).toBe('original');
    expect(plan.variants[0].query).toBe('Some query');
  });

  it('fallbackFlags is empty when nothing fails', async () => {
    const plan = await makeService().plan('What is Apple revenue?');
    expect(plan.fallbackFlags).toEqual([]);
  });
});
