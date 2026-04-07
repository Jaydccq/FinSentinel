import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RetrievalPlannerService } from '../retrieval-planner.service';

describe('RetrievalPlannerService', () => {
  let service: RetrievalPlannerService;
  let mockRewrite: { rewrite: Mock };

  beforeEach(() => {
    mockRewrite = { rewrite: vi.fn().mockImplementation((q: string) => Promise.resolve(q)) };
    service = new RetrievalPlannerService(mockRewrite as any);
  });

  it('always includes dense and sparse lanes', async () => {
    const plan = await service.plan('What is Apple revenue?');
    expect(plan.lanes).toContain('dense');
    expect(plan.lanes).toContain('sparse');
  });

  it('activates graph lane for relational queries', async () => {
    const plan = await service.plan('Who are the main competitors of Tesla?');
    expect(plan.lanes).toContain('graph');
  });

  it('activates graph lane for supply chain queries', async () => {
    const plan = await service.plan('Which companies supply NVIDIA with chips?');
    expect(plan.lanes).toContain('graph');
  });

  it('does NOT activate graph lane for simple factual queries', async () => {
    const plan = await service.plan('AAPL stock price today');
    expect(plan.lanes).not.toContain('graph');
  });

  it('delegates to QueryRewriteService', async () => {
    await service.plan('test query');
    expect(mockRewrite.rewrite).toHaveBeenCalledWith('test query');
  });

  it('returns the rewritten query in the plan', async () => {
    mockRewrite.rewrite.mockResolvedValueOnce('optimized test query');
    const plan = await service.plan('test query');
    expect(plan.originalQuery).toBe('test query');
    expect(plan.rewrittenQuery).toBe('optimized test query');
  });

  it('includes default topKPerLane', async () => {
    const plan = await service.plan('test');
    expect(plan.topKPerLane).toBe(20);
  });
});
