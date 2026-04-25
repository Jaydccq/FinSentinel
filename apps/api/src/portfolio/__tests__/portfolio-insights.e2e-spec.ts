import { describe, it, expect, vi } from 'vitest';
import { portfolioInsightSchema } from '@finsentinel/shared';
import { PortfolioInsightsService } from '../portfolio-insights.service';
import { PortfolioService } from '../portfolio.service';
import { NewsAnalysisService } from '../../agent/news-analysis.service';

describe('PortfolioInsight schema contract', () => {
  it('service output passes shared Zod schema validation', async () => {
    const portfolioService = {
      getPortfolioAnalytics: vi.fn().mockResolvedValue({
        totalMarketValue: '50000.00',
        sectorAllocation: { Technology: '30000.00', Healthcare: '20000.00' },
        hhiIndex: 1300,
        hhiClassification: 'Well Diversified',
        holdingWeights: [
          {
            symbol: 'AAPL',
            companyName: 'Apple',
            sector: 'Technology',
            marketValue: '30000.00',
            weightPercent: '60.00',
            unrealizedPnl: '3000.00',
            pnlPercent: '11.11',
          },
          {
            symbol: 'JNJ',
            companyName: 'J&J',
            sector: 'Healthcare',
            marketValue: '20000.00',
            weightPercent: '40.00',
            unrealizedPnl: '1000.00',
            pnlPercent: '5.26',
          },
        ],
        concentrationWarnings: ['AAPL represents 60.00% of portfolio (>25% threshold)'],
      }),
    };
    const newsService = {
      getRecentNews: vi
        .fn()
        .mockResolvedValue('No recent news found for AAPL in the last 7 day(s).'),
    };

    const service = new PortfolioInsightsService(
      portfolioService as unknown as PortfolioService,
      newsService as unknown as NewsAnalysisService,
    );

    const result = await service.getInsight('user-1', '550e8400-e29b-41d4-a716-446655440000');
    const parsed = portfolioInsightSchema.safeParse(result);

    if (!parsed.success) {
      console.error('Zod validation errors:', parsed.error.format());
    }
    expect(parsed.success).toBe(true);
  });

  it('empty-state output passes schema validation', async () => {
    const portfolioService = {
      getPortfolioAnalytics: vi.fn().mockResolvedValue({
        totalMarketValue: '0.00',
        sectorAllocation: {},
        hhiIndex: 0,
        hhiClassification: 'Well Diversified',
        holdingWeights: [],
        concentrationWarnings: [],
      }),
    };
    const newsService = {
      getRecentNews: vi.fn(),
    };

    const service = new PortfolioInsightsService(
      portfolioService as unknown as PortfolioService,
      newsService as unknown as NewsAnalysisService,
    );

    const result = await service.getInsight('user-1', '550e8400-e29b-41d4-a716-446655440000');
    const parsed = portfolioInsightSchema.safeParse(result);

    if (!parsed.success) {
      console.error('Zod validation errors:', parsed.error.format());
    }
    expect(parsed.success).toBe(true);
    expect(result.freshness).toBe('empty');
  });
});
