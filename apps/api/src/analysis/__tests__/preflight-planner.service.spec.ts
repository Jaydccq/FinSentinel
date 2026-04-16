import { describe, it, expect } from 'vitest';
import { ContextComplexityService } from '../context-complexity.service';
import { PreflightPlannerService } from '../preflight-planner.service';

describe('ContextComplexityService.estimate', () => {
  const svc = new ContextComplexityService();

  it('lightweight query stays below all thresholds', () => {
    const est = svc.estimate({ prompt: 'What is the current price of AAPL?' });
    expect(est.upgradeRecommended).toBe(false);
    expect(est.predictedToolCalls).toBeLessThan(6);
  });

  it('"complete analysis" phrasing forces upgrade via intent', () => {
    const est = svc.estimate({ prompt: 'Give me a complete analysis of AAPL' });
    expect(est.upgradeRecommended).toBe(true);
    expect(est.upgradeReason).toMatch(/complete analysis|intent/i);
  });

  it('"generate order draft" phrasing forces upgrade', () => {
    const est = svc.estimate({ prompt: 'Generate an order draft for TSLA' });
    expect(est.upgradeRecommended).toBe(true);
  });

  it('tool-call threshold triggers upgrade', () => {
    const est = svc.estimate({
      prompt:
        'Analyze AAPL valuation and compare to MSFT, GOOGL, META, AMZN across fundamentals and technicals',
    });
    expect(est.predictedToolCalls).toBeGreaterThanOrEqual(6);
    expect(est.upgradeRecommended).toBe(true);
  });
});

describe('PreflightPlannerService', () => {
  const planner = new PreflightPlannerService(new ContextComplexityService());

  it('decide() returns the estimate and a human-readable reason', async () => {
    const out = await planner.decide({ prompt: 'Complete analysis of AAPL' });
    expect(out.upgradeRecommended).toBe(true);
    expect(out.upgradeReason.length).toBeGreaterThan(0);
  });
});
