import { BadRequestException, Injectable } from '@nestjs/common';
import { EMA, RSI, SMA, Stochastic } from 'technicalindicators';
import type {
  StrategyCostProfile,
  StrategyIndicatorSnapshot,
  StrategyRecommendedNextStep,
  StrategySignal,
  StrategyTemplateEvaluation,
  StrategyTemplateKey,
} from '@finsentinel/shared';

interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number;
}

export interface EvaluateStrategyTemplateInput {
  barsJson: string;
  templateKey: StrategyTemplateKey;
  makerFeeBps?: number;
  takerFeeBps?: number;
  expectedAnnualTrades?: number;
}

const DEFAULT_MAKER_FEE_BPS = 1.5;
const DEFAULT_TAKER_FEE_BPS = 4.5;
const DEFAULT_EXPECTED_ANNUAL_TRADES = 36;
const HIGH_FREQUENCY_TRADE_THRESHOLD = 200;

@Injectable()
export class StrategyTemplateService {
  evaluate(input: EvaluateStrategyTemplateInput): StrategyTemplateEvaluation {
    const bars = this.parseBars(input.barsJson);
    const requiredBars = this.requiredBarsFor(input.templateKey);
    const indicatorSnapshot = this.buildIndicatorSnapshot(bars);
    const costProfile = this.buildCostProfile(input);
    const warnings = this.buildWarnings(bars.length, requiredBars, costProfile);

    if (bars.length < requiredBars) {
      return {
        templateKey: input.templateKey,
        signal: 'BLOCKED',
        confidence: 0,
        recommendedNextStep: 'REJECT',
        reasons: [`Need at least ${requiredBars} bars to evaluate this template.`],
        warnings,
        requiredBars,
        receivedBars: bars.length,
        indicatorSnapshot,
        costProfile,
      };
    }

    const ruleResult = this.evaluateTemplate(input.templateKey, indicatorSnapshot);

    return {
      templateKey: input.templateKey,
      signal: ruleResult.signal,
      confidence: ruleResult.confidence,
      recommendedNextStep: this.recommendedNextStep(ruleResult.signal, costProfile),
      reasons: ruleResult.reasons,
      warnings,
      requiredBars,
      receivedBars: bars.length,
      indicatorSnapshot,
      costProfile,
    };
  }

  private evaluateTemplate(
    templateKey: StrategyTemplateKey,
    snapshot: StrategyIndicatorSnapshot,
  ): { signal: StrategySignal; confidence: number; reasons: string[] } {
    switch (templateKey) {
      case 'BTC_RSI_STOCH_EMA_MEAN_REVERSION':
        return this.evaluateMeanReversion(snapshot);
      case 'RSI_70_MOMENTUM_CONTINUATION':
        return this.evaluateRsiMomentum(snapshot);
      case 'SMA_50_200_RSI_LONG_ONLY':
        return this.evaluateLongOnlyTrend(snapshot);
    }
  }

  private evaluateMeanReversion(snapshot: StrategyIndicatorSnapshot): {
    signal: StrategySignal;
    confidence: number;
    reasons: string[];
  } {
    const { close, ema200, rsi14, stochasticK14 } = snapshot;
    if (rsi14 === null || stochasticK14 === null || ema200 === null) {
      return {
        signal: 'BLOCKED',
        confidence: 0,
        reasons: ['RSI, Stochastic, and EMA200 are required for this template.'],
      };
    }

    if (rsi14 <= 20 && stochasticK14 <= 25 && close > ema200) {
      return {
        signal: 'ENTER_LONG',
        confidence: 0.78,
        reasons: [
          'RSI is in an oversold zone while price remains above EMA200.',
          'Stochastic confirms a short-term pullback inside the larger uptrend.',
        ],
      };
    }

    if (rsi14 >= 65 || close < ema200) {
      return {
        signal: 'EXIT_LONG',
        confidence: 0.7,
        reasons: ['Mean-reversion edge is no longer favorable by RSI or trend filter.'],
      };
    }

    return {
      signal: 'HOLD',
      confidence: 0.58,
      reasons: ['Pullback conditions are not extreme enough for a fresh entry.'],
    };
  }

  private evaluateRsiMomentum(snapshot: StrategyIndicatorSnapshot): {
    signal: StrategySignal;
    confidence: number;
    reasons: string[];
  } {
    const { rsi14 } = snapshot;
    if (rsi14 === null) {
      return {
        signal: 'BLOCKED',
        confidence: 0,
        reasons: ['RSI14 is required for this template.'],
      };
    }

    if (rsi14 >= 70) {
      const confidence = Math.min(0.9, 0.72 + (rsi14 - 70) / 200);
      return {
        signal: 'ENTER_LONG',
        confidence,
        reasons: ['RSI is above 70, matching the momentum-continuation entry rule.'],
      };
    }

    return {
      signal: 'EXIT_LONG',
      confidence: 0.65,
      reasons: ['RSI is below 70, matching the template exit rule.'],
    };
  }

  private evaluateLongOnlyTrend(snapshot: StrategyIndicatorSnapshot): {
    signal: StrategySignal;
    confidence: number;
    reasons: string[];
  } {
    const { close, rsi14, sma50, sma200 } = snapshot;
    if (rsi14 === null || sma50 === null || sma200 === null) {
      return {
        signal: 'BLOCKED',
        confidence: 0,
        reasons: ['RSI14, SMA50, and SMA200 are required for this template.'],
      };
    }

    if (close > sma50 && sma50 > sma200 && rsi14 >= 50) {
      return {
        signal: 'ENTER_LONG',
        confidence: 0.76,
        reasons: [
          'Price is above SMA50 and SMA50 is above SMA200.',
          'RSI confirms positive momentum for a long-only trend template.',
        ],
      };
    }

    if (close < sma200 || rsi14 < 45) {
      return {
        signal: 'EXIT_LONG',
        confidence: 0.7,
        reasons: ['Long-only trend filter is broken by price or RSI.'],
      };
    }

    return {
      signal: 'HOLD',
      confidence: 0.6,
      reasons: ['Trend is constructive but not strong enough for a fresh entry.'],
    };
  }

  private buildIndicatorSnapshot(bars: Bar[]): StrategyIndicatorSnapshot {
    const closes = bars.map((bar) => bar.c);
    const highs = bars.map((bar) => bar.h);
    const lows = bars.map((bar) => bar.l);

    return {
      close: this.last(closes),
      rsi14: this.lastOrNull(RSI.calculate({ values: closes, period: 14 })),
      stochasticK14: this.latestStochasticValue(highs, lows, closes, 'k'),
      stochasticD3: this.latestStochasticValue(highs, lows, closes, 'd'),
      ema200: this.lastOrNull(EMA.calculate({ values: closes, period: 200 })),
      sma50: this.lastOrNull(SMA.calculate({ values: closes, period: 50 })),
      sma200: this.lastOrNull(SMA.calculate({ values: closes, period: 200 })),
    };
  }

  private latestStochasticValue(
    highs: number[],
    lows: number[],
    closes: number[],
    key: 'k' | 'd',
  ): number | null {
    const values = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });

    if (values.length === 0) return null;
    const latest = this.last(values);
    return latest[key] ?? null;
  }

  private buildCostProfile(input: EvaluateStrategyTemplateInput): StrategyCostProfile {
    const makerFeeBps = input.makerFeeBps ?? DEFAULT_MAKER_FEE_BPS;
    const takerFeeBps = input.takerFeeBps ?? DEFAULT_TAKER_FEE_BPS;
    const expectedAnnualTrades = input.expectedAnnualTrades ?? DEFAULT_EXPECTED_ANNUAL_TRADES;
    const estimatedRoundTripBps = makerFeeBps + takerFeeBps;

    return {
      makerFeeBps,
      takerFeeBps,
      estimatedRoundTripBps,
      expectedAnnualTrades,
      feeDragWarning: expectedAnnualTrades > HIGH_FREQUENCY_TRADE_THRESHOLD,
    };
  }

  private buildWarnings(
    receivedBars: number,
    requiredBars: number,
    costProfile: StrategyCostProfile,
  ): string[] {
    const warnings: string[] = [];
    if (receivedBars < requiredBars) {
      warnings.push('Insufficient bars for this template.');
    }

    if (costProfile.feeDragWarning) {
      warnings.push('Expected annual trades exceed 200; fee drag can erase thin edges.');
    }

    return warnings;
  }

  private recommendedNextStep(
    signal: StrategySignal,
    costProfile: StrategyCostProfile,
  ): StrategyRecommendedNextStep {
    if (signal === 'BLOCKED') return 'REJECT';
    if (costProfile.feeDragWarning) return 'PAPER_ONLY';
    if (signal === 'ENTER_LONG') return 'REVIEW_FOR_BACKTEST';
    return 'PAPER_ONLY';
  }

  private requiredBarsFor(templateKey: StrategyTemplateKey): number {
    if (templateKey === 'RSI_70_MOMENTUM_CONTINUATION') return 15;
    return 200;
  }

  private parseBars(barsJson: string): Bar[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(barsJson);
    } catch {
      throw new BadRequestException('barsJson must be valid JSON.');
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new BadRequestException('barsJson must be a non-empty OHLCV array.');
    }

    return parsed.map((bar, index) => this.parseBar(bar, index));
  }

  private parseBar(bar: unknown, index: number): Bar {
    if (typeof bar !== 'object' || bar === null) {
      throw new BadRequestException(`barsJson[${index}] must be an OHLCV object.`);
    }

    const record = bar as Record<string, unknown>;
    const parsedBar = {
      o: this.readFiniteNumber(record, 'o', index),
      h: this.readFiniteNumber(record, 'h', index),
      l: this.readFiniteNumber(record, 'l', index),
      c: this.readFiniteNumber(record, 'c', index),
      v: this.readFiniteNumber(record, 'v', index),
      t: this.readFiniteNumber(record, 't', index),
    };

    if (parsedBar.h < parsedBar.l) {
      throw new BadRequestException(
        `barsJson[${index}] high must be greater than or equal to low.`,
      );
    }

    return parsedBar;
  }

  private readFiniteNumber(
    record: Record<string, unknown>,
    field: keyof Bar,
    index: number,
  ): number {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`barsJson[${index}].${field} must be a finite number.`);
    }

    return value;
  }

  private last(values: number[]): number;
  private last(values: Array<{ k?: number; d?: number }>): { k?: number; d?: number };
  private last<T>(values: T[]): T {
    if (values.length === 0) {
      throw new Error('Unexpected empty indicator result.');
    }

    return values[values.length - 1]!;
  }

  private lastOrNull(values: number[]): number | null {
    if (values.length === 0) return null;
    return this.last(values);
  }
}
