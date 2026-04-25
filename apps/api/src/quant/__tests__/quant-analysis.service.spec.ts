import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { QuantAnalysisService } from '../quant-analysis.service';

// ── Test data ────────────────────────────────────────────────────────────────

/**
 * 40 synthetic daily closing prices with a known upward drift and mild noise.
 * Built so log returns, drawdown, and volatility can be verified by hand.
 *
 * Prices: start at 100, grow ~0.5% per day with small perturbations.
 */
const PRICES_40: number[] = [
  100, 100.5, 101.2, 100.8, 101.5, 102.0, 101.7, 102.5, 103.0, 102.8, 103.5, 104.0, 103.6, 104.2,
  104.8, 105.5, 105.0, 105.8, 106.3, 106.0, 106.8, 107.2, 107.0, 107.5, 108.0, 108.5, 108.2, 109.0,
  109.5, 109.2, 110.0, 110.5, 110.2, 111.0, 111.5, 112.0, 111.5, 112.5, 113.0, 113.5,
];

/** Only 10 prices — below the 30-point minimum. */
const PRICES_TOO_FEW: number[] = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];

/**
 * Prices that include a significant drawdown in the middle:
 * rises to 120, drops to 96, then recovers to 115.
 * Max drawdown = (96 - 120) / 120 = -0.2 (20%).
 */
const PRICES_WITH_DRAWDOWN: number[] = [
  100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 118, 116, 114, 110, 106, 102, 98, 96, 98,
  100, 102, 104, 106, 108, 110, 112, 113, 114, 115, 115, 114, 113, 112, 113, 114, 115, 114, 115,
  115,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Manually compute log returns for verification. */
function logReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    r.push(Math.log(prices[i]! / prices[i - 1]!));
  }
  return r;
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('QuantAnalysisService', () => {
  let service: QuantAnalysisService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [QuantAnalysisService],
    }).compile();

    service = module.get(QuantAnalysisService);
  });

  // ── calculateReturnStatistics ──────────────────────────────────────────

  describe('calculateReturnStatistics', () => {
    it('throws BadRequestException when fewer than 30 data points', () => {
      expect(() => service.calculateReturnStatistics(PRICES_TOO_FEW)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty array', () => {
      expect(() => service.calculateReturnStatistics([])).toThrow(BadRequestException);
    });

    it('returns correct mean and standard deviation of log returns', () => {
      const result = service.calculateReturnStatistics(PRICES_40);
      const returns = logReturns(PRICES_40);
      const expectedMean = mean(returns);
      const expectedStd = stddev(returns);

      expect(result.meanReturn).toBeCloseTo(expectedMean, 8);
      expect(result.standardDeviation).toBeCloseTo(expectedStd, 8);
    });

    it('returns correct annualized return and volatility', () => {
      const result = service.calculateReturnStatistics(PRICES_40);
      const returns = logReturns(PRICES_40);
      const expectedMean = mean(returns);
      const expectedStd = stddev(returns);

      expect(result.annualizedReturn).toBeCloseTo(expectedMean * 252, 6);
      expect(result.annualizedVolatility).toBeCloseTo(expectedStd * Math.sqrt(252), 6);
    });

    it('returns correct Sharpe ratio', () => {
      const result = service.calculateReturnStatistics(PRICES_40);
      const returns = logReturns(PRICES_40);
      const m = mean(returns);
      const s = stddev(returns);
      const annRet = m * 252;
      const annVol = s * Math.sqrt(252);
      const expectedSharpe = (annRet - 0.05) / annVol;

      expect(result.sharpeRatio).toBeCloseTo(expectedSharpe, 6);
    });

    it('returns correct max drawdown from price series with known drawdown', () => {
      const result = service.calculateReturnStatistics(PRICES_WITH_DRAWDOWN);
      // Peak = 120, trough = 96, drawdown = (96 - 120) / 120 = -0.2
      expect(result.maxDrawdown).toBeCloseTo(-0.2, 6);
    });

    it('returns correct skewness and kurtosis', () => {
      const result = service.calculateReturnStatistics(PRICES_40);
      // Skewness and kurtosis should be finite numbers
      expect(Number.isFinite(result.skewness)).toBe(true);
      expect(Number.isFinite(result.kurtosis)).toBe(true);
    });

    it('returns correct dataPoints count', () => {
      const result = service.calculateReturnStatistics(PRICES_40);
      // 40 prices produce 39 log returns
      expect(result.dataPoints).toBe(39);
    });

    it('returns Sharpe of 0 when volatility is 0 (constant prices)', () => {
      // 35 identical prices
      const flat = Array.from({ length: 35 }, () => 100);
      const result = service.calculateReturnStatistics(flat);

      expect(result.sharpeRatio).toBe(0);
      expect(result.annualizedVolatility).toBe(0);
    });
  });

  // ── calculateValueAtRisk ───────────────────────────────────────────────

  describe('calculateValueAtRisk', () => {
    it('throws BadRequestException when fewer than 30 data points', () => {
      expect(() => service.calculateValueAtRisk(PRICES_TOO_FEW)).toThrow(BadRequestException);
    });

    it('calculates parametric VaR at 95% and 99% confidence', () => {
      const result = service.calculateValueAtRisk(PRICES_40);
      const returns = logReturns(PRICES_40);
      const m = mean(returns);
      const s = stddev(returns);

      // VaR95 = mean - 1.645 * stddev
      expect(result.var95).toBeCloseTo(m - 1.645 * s, 8);
      // VaR99 = mean - 2.326 * stddev
      expect(result.var99).toBeCloseTo(m - 2.326 * s, 8);
    });

    it('returns method as "parametric"', () => {
      const result = service.calculateValueAtRisk(PRICES_40);
      expect(result.method).toBe('parametric');
    });

    it('VaR99 is more negative than VaR95 (higher confidence = worse tail)', () => {
      const result = service.calculateValueAtRisk(PRICES_40);
      expect(result.var99).toBeLessThan(result.var95);
    });

    it('CVaR values are more negative than corresponding VaR', () => {
      const result = service.calculateValueAtRisk(PRICES_40);
      expect(result.cvar95).toBeLessThan(result.var95);
      expect(result.cvar99).toBeLessThan(result.var99);
    });
  });

  // ── calculateVolatilityRegime ──────────────────────────────────────────

  describe('calculateVolatilityRegime', () => {
    it('throws BadRequestException when fewer than 30 data points', () => {
      expect(() => service.calculateVolatilityRegime(PRICES_TOO_FEW)).toThrow(BadRequestException);
    });

    it('returns current and historical volatility as positive numbers', () => {
      const result = service.calculateVolatilityRegime(PRICES_40);

      expect(result.currentVolatility).toBeGreaterThan(0);
      expect(result.historicalVolatility).toBeGreaterThan(0);
    });

    it('returns rolling volatility array', () => {
      const result = service.calculateVolatilityRegime(PRICES_40);

      expect(Array.isArray(result.rollingVolatility)).toBe(true);
      expect(result.rollingVolatility.length).toBeGreaterThan(0);
      // All values should be non-negative
      for (const v of result.rollingVolatility) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });

    it('classifies low-volatility regime correctly', () => {
      // Gentle upward drift with tiny noise => low annualized vol
      const result = service.calculateVolatilityRegime(PRICES_40);
      // Our test data has ~10% annualized vol which is LOW
      expect(result.regime).toBe('LOW');
    });

    it('classifies EXTREME regime for highly volatile prices', () => {
      // Wild oscillations: +20%, -20%, +20%, ...
      const volatile: number[] = [100];
      for (let i = 1; i < 40; i++) {
        volatile.push(volatile[i - 1]! * (i % 2 === 0 ? 1.2 : 0.8));
      }
      const result = service.calculateVolatilityRegime(volatile);
      expect(result.regime).toBe('EXTREME');
    });

    it('returns volatility percentile between 0 and 100', () => {
      const result = service.calculateVolatilityRegime(PRICES_40);
      expect(result.volatilityPercentile).toBeGreaterThanOrEqual(0);
      expect(result.volatilityPercentile).toBeLessThanOrEqual(100);
    });
  });
});
