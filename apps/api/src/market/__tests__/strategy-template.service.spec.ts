import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { StrategyTemplateService } from '../strategy-template.service';

interface TestBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number;
}

function makeBar(close: number, index: number): TestBar {
  return {
    o: close - 0.5,
    h: close + 1,
    l: close - 1,
    c: close,
    v: 1000000,
    t: 1700000000000 + index * 60000,
  };
}

function momentumBars(count = 80): TestBar[] {
  return Array.from({ length: count }, (_, index) => makeBar(100 + index * 1.2, index));
}

function fallingBars(count = 80): TestBar[] {
  return Array.from({ length: count }, (_, index) => makeBar(200 - index * 1.2, index));
}

function meanReversionBars(): TestBar[] {
  const bars = Array.from({ length: 220 }, (_, index) => makeBar(100 + index * 2, index));
  const pullback = Array.from({ length: 20 }, (_, index) =>
    makeBar(538 - index * 2.5, 220 + index),
  );

  return [...bars, ...pullback];
}

function longOnlyBars(): TestBar[] {
  return Array.from({ length: 220 }, (_, index) => makeBar(100 + index * 1.1, index));
}

describe('StrategyTemplateService', () => {
  const service = new StrategyTemplateService();

  it('enters the RSI momentum continuation template when RSI is above 70', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(momentumBars()),
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
    });

    expect(result.signal).toBe('ENTER_LONG');
    expect(result.recommendedNextStep).toBe('REVIEW_FOR_BACKTEST');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.indicatorSnapshot.rsi14).toBeGreaterThanOrEqual(70);
  });

  it('exits the RSI momentum continuation template when RSI falls below 70', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(fallingBars()),
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
    });

    expect(result.signal).toBe('EXIT_LONG');
    expect(result.indicatorSnapshot.rsi14).toBeLessThan(70);
  });

  it('enters the RSI/Stochastic/EMA mean reversion template after a pullback inside an uptrend', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(meanReversionBars()),
      expectedAnnualTrades: 24,
      templateKey: 'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
    });

    expect(result.signal).toBe('ENTER_LONG');
    expect(result.recommendedNextStep).toBe('REVIEW_FOR_BACKTEST');
    expect(result.indicatorSnapshot.rsi14).toBeLessThanOrEqual(20);
    expect(result.indicatorSnapshot.stochasticK14).toBeLessThanOrEqual(25);
    expect(result.indicatorSnapshot.close).toBeGreaterThan(result.indicatorSnapshot.ema200 ?? 0);
    expect(result.costProfile.feeDragWarning).toBe(false);
  });

  it('blocks the long-only SMA template when there are not enough bars', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(momentumBars()),
      templateKey: 'SMA_50_200_RSI_LONG_ONLY',
    });

    expect(result.signal).toBe('BLOCKED');
    expect(result.recommendedNextStep).toBe('REJECT');
    expect(result.requiredBars).toBe(200);
    expect(result.receivedBars).toBe(80);
    expect(result.warnings).toContain('Insufficient bars for this template.');
  });

  it('enters the long-only SMA trend template when trend and RSI filters agree', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(longOnlyBars()),
      templateKey: 'SMA_50_200_RSI_LONG_ONLY',
    });

    expect(result.signal).toBe('ENTER_LONG');
    expect(result.indicatorSnapshot.sma50).toBeGreaterThan(result.indicatorSnapshot.sma200 ?? 0);
    expect(result.indicatorSnapshot.rsi14).toBeGreaterThanOrEqual(50);
  });

  it('warns when expected frequency is above the fee-drag threshold', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(momentumBars()),
      expectedAnnualTrades: 240,
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
    });

    expect(result.costProfile.feeDragWarning).toBe(true);
    expect(result.warnings).toContain(
      'Expected annual trades exceed 200; fee drag can erase thin edges.',
    );
  });

  it('rejects malformed OHLCV input', () => {
    expect(() =>
      service.evaluate({
        barsJson: JSON.stringify([{ c: 100 }]),
        templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid JSON and empty bar arrays', () => {
    expect(() =>
      service.evaluate({
        barsJson: 'not-json',
        templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.evaluate({
        barsJson: '[]',
        templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects non-object bars and non-finite numeric fields', () => {
    expect(() =>
      service.evaluate({
        barsJson: JSON.stringify([null]),
        templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.evaluate({
        barsJson: JSON.stringify([{ o: 1, h: 2, l: 0, c: Number.NaN, v: 1, t: 1 }]),
        templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      }),
    ).toThrow(BadRequestException);
  });
});
