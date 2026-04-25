import { describe, it, expect, beforeEach } from 'vitest';
import { TechnicalIndicatorsService } from '../technical-indicators.service';

// Golden baseline data (30 OHLCV bars, AAPL-like 170-188).
// This fixed dataset is the parity reference for indicator outputs.
const SAMPLE_BARS = [
  { o: 170.0, h: 172.0, l: 169.0, c: 171.5, v: 50000000, t: 1706745600000 },
  { o: 171.5, h: 173.0, l: 170.5, c: 172.0, v: 48000000, t: 1706832000000 },
  { o: 172.0, h: 174.5, l: 171.0, c: 173.5, v: 52000000, t: 1706918400000 },
  { o: 173.5, h: 175.0, l: 172.0, c: 174.0, v: 47000000, t: 1707004800000 },
  { o: 174.0, h: 176.0, l: 173.5, c: 175.5, v: 55000000, t: 1707091200000 },
  { o: 175.5, h: 177.0, l: 174.0, c: 176.0, v: 51000000, t: 1707177600000 },
  { o: 176.0, h: 178.0, l: 175.0, c: 177.5, v: 49000000, t: 1707264000000 },
  { o: 177.5, h: 179.0, l: 176.5, c: 178.0, v: 53000000, t: 1707350400000 },
  { o: 178.0, h: 180.0, l: 177.0, c: 179.0, v: 56000000, t: 1707436800000 },
  { o: 179.0, h: 180.5, l: 177.5, c: 178.5, v: 48000000, t: 1707523200000 },
  { o: 178.5, h: 179.5, l: 177.0, c: 178.0, v: 45000000, t: 1707609600000 },
  { o: 178.0, h: 179.0, l: 176.5, c: 177.0, v: 44000000, t: 1707696000000 },
  { o: 177.0, h: 178.5, l: 176.0, c: 177.5, v: 46000000, t: 1707782400000 },
  { o: 177.5, h: 179.0, l: 176.5, c: 178.5, v: 50000000, t: 1707868800000 },
  { o: 178.5, h: 180.0, l: 177.5, c: 179.5, v: 52000000, t: 1707955200000 },
  { o: 179.5, h: 181.0, l: 178.5, c: 180.0, v: 54000000, t: 1708041600000 },
  { o: 180.0, h: 182.0, l: 179.0, c: 181.5, v: 57000000, t: 1708128000000 },
  { o: 181.5, h: 183.0, l: 180.5, c: 182.0, v: 55000000, t: 1708214400000 },
  { o: 182.0, h: 183.5, l: 181.0, c: 182.5, v: 51000000, t: 1708300800000 },
  { o: 182.5, h: 184.0, l: 181.5, c: 183.0, v: 53000000, t: 1708387200000 },
  { o: 183.0, h: 184.5, l: 182.0, c: 183.5, v: 49000000, t: 1708473600000 },
  { o: 183.5, h: 185.0, l: 182.5, c: 184.0, v: 56000000, t: 1708560000000 },
  { o: 184.0, h: 185.5, l: 183.0, c: 184.5, v: 52000000, t: 1708646400000 },
  { o: 184.5, h: 186.0, l: 183.5, c: 185.0, v: 54000000, t: 1708732800000 },
  { o: 185.0, h: 186.5, l: 184.0, c: 185.5, v: 50000000, t: 1708819200000 },
  { o: 185.5, h: 187.0, l: 184.5, c: 186.0, v: 55000000, t: 1708905600000 },
  { o: 186.0, h: 187.5, l: 185.0, c: 186.5, v: 53000000, t: 1708992000000 },
  { o: 186.5, h: 188.0, l: 185.5, c: 187.0, v: 57000000, t: 1709078400000 },
  { o: 187.0, h: 188.5, l: 186.0, c: 187.5, v: 51000000, t: 1709164800000 },
  { o: 187.5, h: 189.0, l: 186.5, c: 188.0, v: 54000000, t: 1709251200000 },
];

const SAMPLE_BARS_JSON = JSON.stringify(SAMPLE_BARS);

// Golden baseline expected values.
const GOLDEN = {
  rsi14: 93.42,
  macd: { macdLine: 1.0368, signalLine: 1.0236, histogram: 0.0132 },
  bollinger: { upper: 189.66, middle: 182.85, lower: 176.04, percentB: 0.88, bandWidth: 7.45 },
  ema9: 185.96,
  sma20: 182.85,
  atr: { value: 2.615, atrPct: 1.39 },
  stochastic: { k: 90.0, d: 90.16 },
  adx: { adx: 74.2, plusDI: 19.62, minusDI: 1.08 },
  obv: 1273000000,
};

// Tolerances.
// Different TA libraries may use slightly different smoothing algorithms.
// RSI in particular can vary slightly across implementations.
const TOL = {
  RSI: 1.0,
  MACD: 0.1,
  BOLLINGER_BAND: 0.2,
  BOLLINGER_PB: 0.05,
  BOLLINGER_BW: 0.5,
  EMA: 0.05,
  SMA: 0.05,
  ATR: 0.1,
  ATR_PCT: 0.1,
  STOCHASTIC: 1.0,
  ADX: 2.0,
  ADX_DI: 2.0,
  OBV: 0, // exact -- cumulative addition
};

/**
 * Extract a numeric value from a formatted string using a regex pattern.
 * Throws if the pattern does not match (test will fail with clear message).
 */
function extractValue(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  const captured = match?.[1];
  if (captured === undefined) {
    throw new Error(`Pattern ${String(pattern)} did not match in: ${text}`);
  }
  return parseFloat(captured);
}

describe('TechnicalIndicatorsService', () => {
  let service: TechnicalIndicatorsService;

  beforeEach(() => {
    service = new TechnicalIndicatorsService();
  });

  // ── RSI(14) ──────────────────────────────────────────────────────────────

  describe('RSI(14)', () => {
    it('matches golden baseline value within tolerance', () => {
      const result = service.calculateRSI(SAMPLE_BARS_JSON, 14);
      const rsi = extractValue(result, /Current RSI: ([\d.]+)/);
      expect(Math.abs(rsi - GOLDEN.rsi14)).toBeLessThanOrEqual(TOL.RSI);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 5));
      const result = service.calculateRSI(shortBars, 14);
      expect(result).toContain('Insufficient data');
    });

    it('includes zone classification', () => {
      const result = service.calculateRSI(SAMPLE_BARS_JSON, 14);
      // RSI ~93 should be in overbought zone
      expect(result).toMatch(/overbought/i);
    });
  });

  // ── MACD(8,12,9) ────────────────────────────────────────────────────────

  describe('MACD(8,12,9)', () => {
    it('matches golden baseline MACD line within tolerance', () => {
      const result = service.calculateMACD(SAMPLE_BARS_JSON, 8, 12, 9);
      const macdLine = extractValue(result, /MACD Line: ([-\d.]+)/);
      expect(Math.abs(macdLine - GOLDEN.macd.macdLine)).toBeLessThanOrEqual(TOL.MACD);
    });

    it('matches golden baseline signal line within tolerance', () => {
      const result = service.calculateMACD(SAMPLE_BARS_JSON, 8, 12, 9);
      const signalLine = extractValue(result, /Signal Line: ([-\d.]+)/);
      expect(Math.abs(signalLine - GOLDEN.macd.signalLine)).toBeLessThanOrEqual(TOL.MACD);
    });

    it('matches golden baseline histogram within tolerance', () => {
      const result = service.calculateMACD(SAMPLE_BARS_JSON, 8, 12, 9);
      const histogram = extractValue(result, /Histogram: ([-\d.]+)/);
      expect(Math.abs(histogram - GOLDEN.macd.histogram)).toBeLessThanOrEqual(TOL.MACD);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 5));
      const result = service.calculateMACD(shortBars, 8, 12, 9);
      expect(result).toContain('Insufficient data');
    });
  });

  // ── Bollinger Bands(20,2) ────────────────────────────────────────────────

  describe('BollingerBands(20,2)', () => {
    it('matches golden baseline upper band within tolerance', () => {
      const result = service.calculateBollingerBands(SAMPLE_BARS_JSON, 20, 2);
      const upper = extractValue(result, /Upper Band: ([\d.]+)/);
      expect(Math.abs(upper - GOLDEN.bollinger.upper)).toBeLessThanOrEqual(TOL.BOLLINGER_BAND);
    });

    it('matches golden baseline middle band within tolerance', () => {
      const result = service.calculateBollingerBands(SAMPLE_BARS_JSON, 20, 2);
      const middle = extractValue(result, /Middle Band: ([\d.]+)/);
      expect(Math.abs(middle - GOLDEN.bollinger.middle)).toBeLessThanOrEqual(TOL.BOLLINGER_BAND);
    });

    it('matches golden baseline lower band within tolerance', () => {
      const result = service.calculateBollingerBands(SAMPLE_BARS_JSON, 20, 2);
      const lower = extractValue(result, /Lower Band: ([\d.]+)/);
      expect(Math.abs(lower - GOLDEN.bollinger.lower)).toBeLessThanOrEqual(TOL.BOLLINGER_BAND);
    });

    it('matches golden baseline %B within tolerance', () => {
      const result = service.calculateBollingerBands(SAMPLE_BARS_JSON, 20, 2);
      const pb = extractValue(result, /%B: ([\d.]+)/);
      expect(Math.abs(pb - GOLDEN.bollinger.percentB)).toBeLessThanOrEqual(TOL.BOLLINGER_PB);
    });

    it('matches golden baseline bandwidth within tolerance', () => {
      const result = service.calculateBollingerBands(SAMPLE_BARS_JSON, 20, 2);
      const bw = extractValue(result, /Band Width: ([\d.]+)/);
      expect(Math.abs(bw - GOLDEN.bollinger.bandWidth)).toBeLessThanOrEqual(TOL.BOLLINGER_BW);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 10));
      const result = service.calculateBollingerBands(shortBars, 20, 2);
      expect(result).toContain('Insufficient data');
    });
  });

  // ── EMA(9) ───────────────────────────────────────────────────────────────

  describe('EMA(9)', () => {
    it('matches golden baseline value within tolerance', () => {
      const result = service.calculateEMA(SAMPLE_BARS_JSON, 9);
      const ema = extractValue(result, /Current EMA\(9\): ([\d.]+)/);
      expect(Math.abs(ema - GOLDEN.ema9)).toBeLessThanOrEqual(TOL.EMA);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 3));
      const result = service.calculateEMA(shortBars, 9);
      expect(result).toContain('Insufficient data');
    });
  });

  // ── SMA(20) ──────────────────────────────────────────────────────────────

  describe('SMA(20)', () => {
    it('matches golden baseline value within tolerance', () => {
      const result = service.calculateSMA(SAMPLE_BARS_JSON, 20);
      const sma = extractValue(result, /Current SMA\(20\): ([\d.]+)/);
      expect(Math.abs(sma - GOLDEN.sma20)).toBeLessThanOrEqual(TOL.SMA);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 10));
      const result = service.calculateSMA(shortBars, 20);
      expect(result).toContain('Insufficient data');
    });
  });

  // ── ATR(14) ──────────────────────────────────────────────────────────────

  describe('ATR(14)', () => {
    it('matches golden baseline ATR value within tolerance', () => {
      const result = service.calculateATR(SAMPLE_BARS_JSON, 14);
      const atrVal = extractValue(result, /Current ATR\(14\): ([\d.]+)/);
      expect(Math.abs(atrVal - GOLDEN.atr.value)).toBeLessThanOrEqual(TOL.ATR);
    });

    it('matches golden baseline ATR% within tolerance', () => {
      const result = service.calculateATR(SAMPLE_BARS_JSON, 14);
      const atrPct = extractValue(result, /ATR %: ([\d.]+)%/);
      expect(Math.abs(atrPct - GOLDEN.atr.atrPct)).toBeLessThanOrEqual(TOL.ATR_PCT);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 5));
      const result = service.calculateATR(shortBars, 14);
      expect(result).toContain('Insufficient data');
    });
  });

  // ── Stochastic(14,3) ────────────────────────────────────────────────────

  describe('Stochastic(14,3)', () => {
    it('matches golden baseline %K within tolerance', () => {
      const result = service.calculateStochastic(SAMPLE_BARS_JSON, 14, 3);
      const k = extractValue(result, /%K: ([\d.]+)/);
      expect(Math.abs(k - GOLDEN.stochastic.k)).toBeLessThanOrEqual(TOL.STOCHASTIC);
    });

    it('matches golden baseline %D within tolerance', () => {
      const result = service.calculateStochastic(SAMPLE_BARS_JSON, 14, 3);
      const d = extractValue(result, /%D: ([\d.]+)/);
      expect(Math.abs(d - GOLDEN.stochastic.d)).toBeLessThanOrEqual(TOL.STOCHASTIC);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 5));
      const result = service.calculateStochastic(shortBars, 14, 3);
      expect(result).toContain('Insufficient data');
    });
  });

  // ── ADX(14) ──────────────────────────────────────────────────────────────

  describe('ADX(14)', () => {
    it('matches golden baseline ADX within tolerance', () => {
      const result = service.calculateADX(SAMPLE_BARS_JSON, 14);
      const adxVal = extractValue(result, /ADX: ([\d.]+)/);
      expect(Math.abs(adxVal - GOLDEN.adx.adx)).toBeLessThanOrEqual(TOL.ADX);
    });

    it('matches golden baseline +DI within tolerance', () => {
      const result = service.calculateADX(SAMPLE_BARS_JSON, 14);
      const plusDI = extractValue(result, /\+DI: ([\d.]+)/);
      expect(Math.abs(plusDI - GOLDEN.adx.plusDI)).toBeLessThanOrEqual(TOL.ADX_DI);
    });

    it('matches golden baseline -DI within tolerance', () => {
      const result = service.calculateADX(SAMPLE_BARS_JSON, 14);
      const minusDI = extractValue(result, /-DI: ([\d.]+)/);
      expect(Math.abs(minusDI - GOLDEN.adx.minusDI)).toBeLessThanOrEqual(TOL.ADX_DI);
    });

    it('classifies trend strength', () => {
      const result = service.calculateADX(SAMPLE_BARS_JSON, 14);
      // ADX ~74 is borderline between "Strong" (>=50) and "Extremely Strong" (>=75).
      // Accept either classification since the value sits right at the boundary.
      expect(result).toMatch(/strong trend/i);
    });

    it('returns insufficient data message for too few bars', () => {
      const shortBars = JSON.stringify(SAMPLE_BARS.slice(0, 10));
      const result = service.calculateADX(shortBars, 14);
      expect(result).toContain('Insufficient data');
    });
  });

  // ── OBV ──────────────────────────────────────────────────────────────────

  describe('OBV', () => {
    it('matches golden baseline value exactly', () => {
      const result = service.calculateOBV(SAMPLE_BARS_JSON);
      const match = /Current OBV: ([-\d,]+)/.exec(result);
      const captured = match?.[1];
      if (captured === undefined) throw new Error('OBV pattern did not match');
      const obvVal = parseInt(captured.replace(/,/g, ''), 10);
      expect(obvVal).toBe(GOLDEN.obv);
    });

    it('returns insufficient data message for empty bars', () => {
      const result = service.calculateOBV(JSON.stringify([]));
      expect(result).toContain('Insufficient data');
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('handles invalid JSON gracefully', () => {
      expect(() => service.calculateRSI('not json', 14)).toThrow();
    });

    it('handles single bar without crashing', () => {
      const singleBar = JSON.stringify([SAMPLE_BARS[0]]);
      // Should return insufficient data, not crash
      const result = service.calculateRSI(singleBar, 14);
      expect(result).toContain('Insufficient data');
    });
  });
});
