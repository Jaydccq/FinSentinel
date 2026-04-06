import { describe, it, expect } from 'vitest';
import { portfolioInsightSchema } from '../schemas/portfolio-insight';

describe('portfolioInsightSchema', () => {
  const validInsight = {
    portfolioId: '550e8400-e29b-41d4-a716-446655440000',
    generatedAt: '2026-04-06T12:00:00.000Z',
    freshness: 'full' as const,
    riskScore: 42,
    riskLevel: 'MEDIUM',
    hhiIndex: 1800,
    hhiClassification: 'Moderately Concentrated',
    topHoldingSymbol: 'AAPL',
    topHoldingWeightPercent: '32.50',
    sectorCount: 4,
    concentrationWarnings: ['AAPL represents 32.50% of portfolio (>25% threshold)'],
    holdingCount: 8,
    relevantEvents: [
      {
        headline: 'Apple Q2 earnings beat expectations',
        source: 'Polygon.io',
        publishedAt: '2026-04-05T18:00:00.000Z',
        impactedSymbols: ['AAPL'],
        relevanceReason: 'Directly impacts top holding (32.50% weight)',
      },
    ],
    priorityActions: [
      'Consider trimming AAPL position to reduce single-stock concentration below 25%',
    ],
    narration: 'Your portfolio is moderately concentrated with Apple as the dominant position...',
    narrationFailed: false,
  };

  it('validates a full insight with all fields', () => {
    const result = portfolioInsightSchema.safeParse(validInsight);
    expect(result.success).toBe(true);
  });

  it('accepts degraded insight (narration failed)', () => {
    const degraded = {
      ...validInsight,
      narration: null,
      narrationFailed: true,
      freshness: 'degraded' as const,
    };
    const result = portfolioInsightSchema.safeParse(degraded);
    expect(result.success).toBe(true);
  });

  it('accepts empty-state insight (no holdings)', () => {
    const empty = {
      portfolioId: '550e8400-e29b-41d4-a716-446655440000',
      generatedAt: '2026-04-06T12:00:00.000Z',
      freshness: 'empty' as const,
      riskScore: 0,
      riskLevel: 'LOW',
      hhiIndex: 0,
      hhiClassification: 'Well Diversified',
      topHoldingSymbol: null,
      topHoldingWeightPercent: null,
      sectorCount: 0,
      concentrationWarnings: [],
      holdingCount: 0,
      relevantEvents: [],
      priorityActions: ['Add holdings to get portfolio insights.'],
      narration: null,
      narrationFailed: false,
    };
    const result = portfolioInsightSchema.safeParse(empty);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = portfolioInsightSchema.safeParse({ portfolioId: 'abc' });
    expect(result.success).toBe(false);
  });
});
