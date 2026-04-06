import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortfolioInsightsService } from '../portfolio-insights.service';
import { PortfolioService } from '../portfolio.service';
import { NewsAnalysisService } from '../../agent/news-analysis.service';
import type { PortfolioAnalyticsResponse } from '@finsentinel/shared';

function makeAnalytics(overrides: Partial<PortfolioAnalyticsResponse> = {}): PortfolioAnalyticsResponse {
  return {
    totalMarketValue: '100000.00',
    sectorAllocation: { Technology: '60000.00', Healthcare: '40000.00' },
    hhiIndex: 2000,
    hhiClassification: 'Moderately Concentrated',
    holdingWeights: [
      { symbol: 'AAPL', companyName: 'Apple', sector: 'Technology', marketValue: '60000.00', weightPercent: '60.00', unrealizedPnl: '5000.00', pnlPercent: '9.09' },
      { symbol: 'JNJ', companyName: 'J&J', sector: 'Healthcare', marketValue: '40000.00', weightPercent: '40.00', unrealizedPnl: '2000.00', pnlPercent: '5.26' },
    ],
    concentrationWarnings: [
      'AAPL represents 60.00% of portfolio (>25% threshold)',
      'JNJ represents 40.00% of portfolio (>25% threshold)',
    ],
    ...overrides,
  };
}

describe('PortfolioInsightsService', () => {
  let service: PortfolioInsightsService;
  let portfolioService: { getPortfolioAnalytics: ReturnType<typeof vi.fn> };
  let newsService: { getRecentNews: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    portfolioService = {
      getPortfolioAnalytics: vi.fn().mockResolvedValue(makeAnalytics()),
    };
    newsService = {
      getRecentNews: vi.fn().mockResolvedValue('1. [Reuters] Apple Q2 beats\nPublished: 2026-04-05T18:00:00.000Z\nSummary: Revenue up 12%'),
    };
    service = new PortfolioInsightsService(
      portfolioService as unknown as PortfolioService,
      newsService as unknown as NewsAnalysisService,
    );
  });

  it('returns full insight with risk primitives and events', async () => {
    const insight = await service.getInsight('user-1', 'p-1');

    expect(insight.portfolioId).toBe('p-1');
    expect(insight.riskScore).toBeGreaterThanOrEqual(20);
    expect(insight.riskScore).toBeLessThanOrEqual(100);
    expect(insight.riskLevel).toMatch(/^(LOW|MEDIUM|HIGH)$/);
    expect(insight.hhiIndex).toBe(2000);
    expect(insight.topHoldingSymbol).toBe('AAPL');
    expect(insight.topHoldingWeightPercent).toBe('60.00');
    expect(insight.sectorCount).toBe(2);
    expect(insight.holdingCount).toBe(2);
    expect(insight.concentrationWarnings).toHaveLength(2);
    expect(insight.priorityActions.length).toBeGreaterThan(0);
    expect(insight.narrationFailed).toBe(false);
    expect(insight.freshness).toBe('full');
  });

  it('returns empty-state insight when portfolio has no holdings', async () => {
    portfolioService.getPortfolioAnalytics.mockResolvedValue(
      makeAnalytics({
        totalMarketValue: '0.00',
        holdingWeights: [],
        concentrationWarnings: [],
        sectorAllocation: {},
        hhiIndex: 0,
        hhiClassification: 'Well Diversified',
      }),
    );

    const insight = await service.getInsight('user-1', 'p-1');

    expect(insight.freshness).toBe('empty');
    expect(insight.riskScore).toBe(0);
    expect(insight.holdingCount).toBe(0);
    expect(insight.topHoldingSymbol).toBeNull();
    expect(insight.relevantEvents).toEqual([]);
    expect(insight.priorityActions).toContainEqual(
      expect.stringContaining('Add holdings'),
    );
  });

  it('returns degraded insight when news fetch fails', async () => {
    newsService.getRecentNews.mockRejectedValue(new Error('network timeout'));

    const insight = await service.getInsight('user-1', 'p-1');

    expect(insight.freshness).toBe('degraded');
    expect(insight.relevantEvents).toEqual([]);
    // Risk primitives should still be present
    expect(insight.riskScore).toBeGreaterThan(0);
    expect(insight.holdingCount).toBe(2);
  });

  it('computes concentration-based risk score correctly', async () => {
    // HHI 2000 → concentrationPenalty=22, top 60% → topHoldingPenalty=20,
    // 2 warnings → warningPenalty=16, 2 sectors → diversificationPenalty=10
    // Total: 20+22+20+16+10 = 88
    const insight = await service.getInsight('user-1', 'p-1');
    expect(insight.riskScore).toBe(88);
  });

  it('generates priority actions from concentration warnings', async () => {
    const insight = await service.getInsight('user-1', 'p-1');
    expect(insight.priorityActions.length).toBeGreaterThanOrEqual(2);
    expect(insight.priorityActions[0]).toContain('AAPL');
  });

  it('fetches news only for top 3 holdings by weight', async () => {
    const insight = await service.getInsight('user-1', 'p-1');
    // 2 holdings → 2 news calls
    expect(newsService.getRecentNews).toHaveBeenCalledTimes(2);
    expect(newsService.getRecentNews).toHaveBeenCalledWith('AAPL', 7);
    expect(newsService.getRecentNews).toHaveBeenCalledWith('JNJ', 7);
  });
});
