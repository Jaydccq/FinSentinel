import { describe, expect, it } from 'vitest';
import {
  strategyArchivePayloadSchema,
  strategyArchiveStatusSchema,
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

  it('lists the archive statuses used by runtime evidence', () => {
    expect(strategyArchiveStatusSchema.options.sort()).toEqual(
      ['DEGRADED', 'EVALUATED', 'SKIPPED'].sort(),
    );
  });

  it('parses an evaluated strategy archive payload', () => {
    const payload = {
      status: 'EVALUATED',
      ticker: 'AAPL',
      generatedAt: '2026-04-19T12:00:00.000Z',
      bars: {
        requestedDays: 260,
        receivedBars: 260,
        source: 'polygon.daily',
      },
      evaluations: [
        {
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
        },
      ],
      selectedTemplateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      summary: {
        enterLongCount: 1,
        blockedCount: 0,
        warnings: ['Fee drag is high for this expected frequency.'],
        recommendedNextStep: 'PAPER_ONLY',
      },
    };

    expect(strategyArchivePayloadSchema.parse(payload)).toMatchObject(payload);
  });

  it('parses a skipped strategy archive payload', () => {
    expect(
      strategyArchivePayloadSchema.parse({
        status: 'SKIPPED',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 0,
          source: 'polygon.daily',
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
    ).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'No ticker in run input.',
    });
  });

  it('parses a degraded strategy archive payload', () => {
    expect(
      strategyArchivePayloadSchema.parse({
        status: 'DEGRADED',
        ticker: 'MSFT',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 12,
          source: 'polygon.daily',
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: ['Market data unavailable.'],
          recommendedNextStep: null,
        },
      }),
    ).toMatchObject({
      status: 'DEGRADED',
      ticker: 'MSFT',
    });
  });

  it('rejects evaluated payloads without a ticker or with skip-only fields', () => {
    expect(() =>
      strategyArchivePayloadSchema.parse({
        status: 'EVALUATED',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 260,
          source: 'polygon.daily',
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: [],
          recommendedNextStep: null,
        },
      }),
    ).toThrow();

    expect(() =>
      strategyArchivePayloadSchema.parse({
        status: 'EVALUATED',
        ticker: 'AAPL',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 260,
          source: 'polygon.daily',
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: [],
          recommendedNextStep: null,
        },
        skipReason: 'No ticker in run input.',
      }),
    ).toThrow();
  });

  it('rejects skipped payloads without a skip reason or with evaluated fields', () => {
    expect(() =>
      strategyArchivePayloadSchema.parse({
        status: 'SKIPPED',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 0,
          source: 'polygon.daily',
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: ['No ticker in run input.'],
          recommendedNextStep: null,
        },
      }),
    ).toThrow();

    expect(() =>
      strategyArchivePayloadSchema.parse({
        status: 'SKIPPED',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 0,
          source: 'polygon.daily',
        },
        evaluations: [
          {
            templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
            signal: 'BLOCKED',
            confidence: 0.1,
            recommendedNextStep: 'REJECT',
            reasons: [],
            warnings: [],
            requiredBars: 15,
            receivedBars: 0,
            indicatorSnapshot: {
              close: 125,
              rsi14: null,
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
          },
        ],
        selectedTemplateKey: 'RSI_70_MOMENTUM_CONTINUATION',
        summary: {
          enterLongCount: 0,
          blockedCount: 1,
          warnings: ['No ticker in run input.'],
          recommendedNextStep: 'REJECT',
        },
        skipReason: 'No ticker in run input.',
      }),
    ).toThrow();
  });

  it('rejects degraded payloads without warnings when the payload is otherwise valid', () => {
    expect(() =>
      strategyArchivePayloadSchema.parse({
        status: 'DEGRADED',
        ticker: 'MSFT',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 12,
          source: 'polygon.daily',
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: [],
          recommendedNextStep: null,
        },
      }),
    ).toThrow();
  });
});
