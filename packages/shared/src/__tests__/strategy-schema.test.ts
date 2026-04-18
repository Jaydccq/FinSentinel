import { describe, expect, it } from 'vitest';
import {
  strategyTemplateEvaluationSchema,
  strategyTemplateKeySchema,
} from '../schemas/strategy';

describe('strategy schemas', () => {
  it('lists the v1 Minara-derived templates', () => {
    expect(strategyTemplateKeySchema.options.sort()).toEqual(
      [
        'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
        'RSI_70_MOMENTUM_CONTINUATION',
        'SMA_50_200_RSI_LONG_ONLY',
      ].sort(),
    );
  });

  it('parses a complete strategy template evaluation', () => {
    const evaluation = {
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      signal: 'ENTER_LONG',
      confidence: 0.72,
      recommendedNextStep: 'PAPER_ONLY',
      reasons: ['RSI is above 70 and still rising.'],
      warnings: ['Fee drag is high for this expected frequency.'],
      requiredBars: 15,
      receivedBars: 80,
      indicatorSnapshot: {
        close: 125,
        rsi14: 74.2,
        stochasticK14: null,
        stochasticD3: null,
        ema200: null,
        sma50: null,
        sma200: null,
      },
      costProfile: {
        makerFeeBps: 1.5,
        takerFeeBps: 4.5,
        estimatedRoundTripBps: 6,
        expectedAnnualTrades: 220,
        feeDragWarning: true,
      },
    };

    expect(strategyTemplateEvaluationSchema.parse(evaluation)).toMatchObject(evaluation);
  });

  it('rejects invalid confidence values', () => {
    expect(() =>
      strategyTemplateEvaluationSchema.parse({
        templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
        signal: 'ENTER_LONG',
        confidence: 1.5,
        recommendedNextStep: 'PAPER_ONLY',
        reasons: [],
        warnings: [],
        requiredBars: 15,
        receivedBars: 80,
        indicatorSnapshot: {
          close: 125,
          rsi14: 74.2,
          stochasticK14: null,
          stochasticD3: null,
          ema200: null,
          sma50: null,
          sma200: null,
        },
        costProfile: {
          makerFeeBps: 1.5,
          takerFeeBps: 4.5,
          estimatedRoundTripBps: 6,
          expectedAnnualTrades: 220,
          feeDragWarning: true,
        },
      }),
    ).toThrow();
  });

  it('rejects unknown template keys', () => {
    expect(() => strategyTemplateKeySchema.parse('UNKNOWN_TEMPLATE')).toThrow();
  });
});
