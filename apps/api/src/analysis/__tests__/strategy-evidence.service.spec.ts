import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MarketBar, StrategyTemplateEvaluation } from '@finsentinel/shared';
import { strategyArchivePayloadSchema } from '@finsentinel/shared';

import { MarketDataService } from '../../market/market-data.service';
import { StrategyTemplateService } from '../../market/strategy-template.service';
import { StrategyEvidenceService } from '../strategy-evidence.service';

function makeMarketBar(index: number): MarketBar {
  const open = 100 + index;
  const close = open + 0.25;
  return {
    open: open.toFixed(2),
    high: (open + 1).toFixed(2),
    low: (open - 1).toFixed(2),
    close: close.toFixed(2),
    volume: 1000 + index,
    timestamp: 1700000000000 + index * 86_400_000,
  };
}

function makeInvalidMarketBar(): MarketBar {
  return {
    open: '   ',
    high: '101.00',
    low: '99.00',
    close: '100.25',
    volume: 1000,
    timestamp: 1700000000000,
  };
}

function makeMarketBars(count = 260): MarketBar[] {
  return Array.from({ length: count }, (_, index) => makeMarketBar(index));
}

function makeEvaluation(
  templateKey: StrategyTemplateEvaluation['templateKey'],
  overrides: Partial<StrategyTemplateEvaluation> = {},
): StrategyTemplateEvaluation {
  return {
    templateKey,
    signal: 'HOLD',
    confidence: 0.5,
    recommendedNextStep: 'PAPER_ONLY',
    reasons: ['Baseline evaluation.'],
    warnings: [],
    requiredBars: 15,
    receivedBars: 260,
    indicatorSnapshot: {
      close: 100,
      rsi14: 55,
      stochasticK14: 50,
      stochasticD3: 50,
      ema200: 95,
      sma50: 98,
      sma200: 90,
    },
    costProfile: {
      makerFeeBps: 1.5,
      takerFeeBps: 4.5,
      estimatedRoundTripBps: 6,
      expectedAnnualTrades: 36,
      feeDragWarning: false,
    },
    ...overrides,
  };
}

describe('StrategyEvidenceService', () => {
  let marketDataService: {
    getHistoricalBars: ReturnType<typeof vi.fn>;
  };
  let strategyTemplateService: {
    evaluate: ReturnType<typeof vi.fn>;
  };
  let service: StrategyEvidenceService;

  beforeEach(async () => {
    marketDataService = {
      getHistoricalBars: vi.fn().mockResolvedValue(makeMarketBars()),
    };
    strategyTemplateService = {
      evaluate: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        StrategyEvidenceService,
        {
          provide: MarketDataService,
          useValue: marketDataService,
        },
        {
          provide: StrategyTemplateService,
          useValue: strategyTemplateService,
        },
      ],
    }).compile();

    service = module.get(StrategyEvidenceService);
  });

  it('returns a skipped archive when no ticker is provided', async () => {
    const result = await service.buildArchive({
      generatedAt: new Date('2026-04-19T12:00:00.000Z'),
    });

    expect(result).toEqual(
      strategyArchivePayloadSchema.parse({
        status: 'SKIPPED',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 0,
          source: 'market-data.service',
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: ['No ticker in run input.'],
          recommendedNextStep: null,
        },
        skipReason: 'No ticker in run input.',
      }),
    );

    expect(marketDataService.getHistoricalBars).not.toHaveBeenCalled();
    expect(strategyTemplateService.evaluate).not.toHaveBeenCalled();
  });

  it('fetches bars once and selects REVIEW_FOR_BACKTEST over PAPER_ONLY', async () => {
    strategyTemplateService.evaluate.mockImplementation(({ templateKey }) => {
      switch (templateKey) {
        case 'BTC_RSI_STOCH_EMA_MEAN_REVERSION':
          return makeEvaluation(templateKey, {
            signal: 'ENTER_LONG',
            confidence: 0.71,
            recommendedNextStep: 'REVIEW_FOR_BACKTEST',
            reasons: ['Mean reversion looks favorable.'],
            warnings: ['Mean reversion warning.'],
          });
        case 'RSI_70_MOMENTUM_CONTINUATION':
          return makeEvaluation(templateKey, {
            signal: 'HOLD',
            confidence: 0.95,
            recommendedNextStep: 'PAPER_ONLY',
            reasons: ['Momentum is present but not strong enough.'],
            warnings: ['Momentum warning.'],
          });
        case 'SMA_50_200_RSI_LONG_ONLY':
          return makeEvaluation(templateKey, {
            signal: 'BLOCKED',
            confidence: 1,
            recommendedNextStep: 'REJECT',
            reasons: ['Template is blocked.'],
            warnings: ['Blocked warning.'],
          });
      }
    });

    const result = await service.buildArchive({
      ticker: 'AAPL',
      generatedAt: new Date('2026-04-19T12:00:00.000Z'),
    });

    expect(strategyArchivePayloadSchema.parse(result)).toMatchObject({
      status: 'EVALUATED',
      ticker: 'AAPL',
      generatedAt: '2026-04-19T12:00:00.000Z',
      bars: {
        requestedDays: 260,
        receivedBars: 260,
        source: 'market-data.service',
      },
      selectedTemplateKey: 'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
      summary: {
        enterLongCount: 1,
        blockedCount: 1,
        warnings: ['Mean reversion warning.', 'Momentum warning.', 'Blocked warning.'],
        recommendedNextStep: 'REVIEW_FOR_BACKTEST',
      },
    });

    expect(marketDataService.getHistoricalBars).toHaveBeenCalledOnce();
    expect(marketDataService.getHistoricalBars).toHaveBeenCalledWith('AAPL', 260);
    expect(strategyTemplateService.evaluate).toHaveBeenCalledTimes(3);

    const firstCall = strategyTemplateService.evaluate.mock.calls[0][0] as {
      barsJson: string;
    };
    const numericBars = JSON.parse(firstCall.barsJson) as Array<{
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
      t: number;
    }>;

    expect(numericBars[0]).toEqual({
      o: 100,
      h: 101,
      l: 99,
      c: 100.25,
      v: 1000,
      t: 1700000000000,
    });
    expect(typeof numericBars[0].o).toBe('number');
  });

  it('returns a degraded archive when market data fails', async () => {
    marketDataService.getHistoricalBars.mockRejectedValueOnce(new Error('market down'));

    const result = await service.buildArchive({
      ticker: 'MSFT',
    });

    expect(strategyArchivePayloadSchema.parse(result)).toMatchObject({
      status: 'DEGRADED',
      ticker: 'MSFT',
      bars: {
        requestedDays: 260,
        receivedBars: 0,
        source: 'market-data.unavailable',
      },
      evaluations: [],
      selectedTemplateKey: null,
      summary: {
        enterLongCount: 0,
        blockedCount: 0,
        warnings: ['Strategy evidence market data failed: market down'],
        recommendedNextStep: null,
      },
    });

    expect(strategyTemplateService.evaluate).not.toHaveBeenCalled();
  });

  it('returns a degraded archive with a clear warning when no bars are returned', async () => {
    marketDataService.getHistoricalBars.mockResolvedValueOnce([]);

    const result = await service.buildArchive({
      ticker: 'AAPL',
    });

    expect(strategyArchivePayloadSchema.parse(result)).toMatchObject({
      status: 'DEGRADED',
      ticker: 'AAPL',
      bars: {
        requestedDays: 260,
        receivedBars: 0,
        source: 'market-data.empty',
      },
      evaluations: [],
      selectedTemplateKey: null,
      summary: {
        enterLongCount: 0,
        blockedCount: 0,
        warnings: ['Strategy evidence market data returned no bars.'],
        recommendedNextStep: null,
      },
    });

    expect(strategyTemplateService.evaluate).not.toHaveBeenCalled();
  });

  it('returns a degraded archive when a market bar has a blank OHLC field', async () => {
    marketDataService.getHistoricalBars.mockResolvedValueOnce([
      makeInvalidMarketBar(),
      ...makeMarketBars(2),
    ]);

    const result = await service.buildArchive({
      ticker: 'AAPL',
    });

    expect(strategyArchivePayloadSchema.parse(result)).toMatchObject({
      status: 'DEGRADED',
      ticker: 'AAPL',
      bars: {
        requestedDays: 260,
        receivedBars: 0,
        source: 'market-data.unavailable',
      },
      evaluations: [],
      selectedTemplateKey: null,
      summary: {
        enterLongCount: 0,
        blockedCount: 0,
        warnings: ['Strategy evidence market data failed: Invalid market bar field open.'],
        recommendedNextStep: null,
      },
    });

    expect(strategyTemplateService.evaluate).not.toHaveBeenCalled();
  });

  it('returns a degraded archive when one template evaluation fails', async () => {
    strategyTemplateService.evaluate.mockImplementation(({ templateKey }) => {
      if (templateKey === 'RSI_70_MOMENTUM_CONTINUATION') {
        throw new Error('template exploded');
      }

      if (templateKey === 'BTC_RSI_STOCH_EMA_MEAN_REVERSION') {
        return makeEvaluation(templateKey, {
          signal: 'ENTER_LONG',
          confidence: 0.8,
          recommendedNextStep: 'REVIEW_FOR_BACKTEST',
          warnings: ['Mean reversion warning.'],
        });
      }

      return makeEvaluation(templateKey, {
        signal: 'BLOCKED',
        confidence: 0.2,
        recommendedNextStep: 'REJECT',
        warnings: ['Blocked warning.'],
      });
    });

    const result = await service.buildArchive({
      ticker: 'AAPL',
    });

    expect(strategyArchivePayloadSchema.parse(result)).toMatchObject({
      status: 'DEGRADED',
      ticker: 'AAPL',
      bars: {
        requestedDays: 260,
        receivedBars: 260,
        source: 'market-data.service',
      },
      selectedTemplateKey: 'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
      summary: {
        enterLongCount: 1,
        blockedCount: 1,
        warnings: [
          'Mean reversion warning.',
          'Strategy template evaluation failed for RSI_70_MOMENTUM_CONTINUATION: template exploded',
          'Blocked warning.',
        ],
        recommendedNextStep: 'REVIEW_FOR_BACKTEST',
      },
    });

    expect(strategyTemplateService.evaluate).toHaveBeenCalledTimes(3);
    expect(result.evaluations).toHaveLength(2);
  });
});
