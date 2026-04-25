import { Injectable } from '@nestjs/common';
import { RSI, MACD, BollingerBands, EMA, SMA, ATR, Stochastic } from 'technicalindicators';

/** OHLCV bar shape used by the technical-indicators service: {o, h, l, c, v, t}. */
interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number;
}

/** Safely get the last element of an array, throwing if empty. */
function last<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error('Unexpected empty array');
  return arr[arr.length - 1]!;
}

/**
 * 9 technical indicators calculated in TypeScript using the `technicalindicators`
 * npm package. Each method accepts a JSON string of OHLCV bars and returns a
 * human-readable formatted string for agent and API consumers.
 *
 * Golden baseline parity is validated against a fixed reference dataset — see
 * the companion spec file for tolerance thresholds.
 */
@Injectable()
export class TechnicalIndicatorsService {
  // ── RSI ──────────────────────────────────────────────────────────────────

  calculateRSI(barsJson: string, period: number): string {
    const bars: Bar[] = JSON.parse(barsJson);
    if (bars.length < period + 1) {
      return `Insufficient data: need at least ${period + 1} bars, got ${bars.length}`;
    }

    const closes = bars.map((b) => b.c);
    const rsiResult = RSI.calculate({ values: closes, period });
    const rsiValue = last(rsiResult);

    const zone = this.classifyRSI(rsiValue);

    return [
      `RSI(${period}) Analysis:`,
      `Current RSI: ${rsiValue.toFixed(2)}`,
      `Zone: ${zone}`,
      `Interpretation: ${this.interpretRSI(rsiValue)}`,
    ].join('\n');
  }

  // ── MACD ─────────────────────────────────────────────────────────────────

  calculateMACD(
    barsJson: string,
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
  ): string {
    const bars: Bar[] = JSON.parse(barsJson);
    // MACD needs at least slowPeriod + signalPeriod bars to produce a signal value
    const minBars = slowPeriod + signalPeriod;
    if (bars.length < minBars) {
      return `Insufficient data: need at least ${minBars} bars, got ${bars.length}`;
    }

    const closes = bars.map((b) => b.c);
    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false, // Use EMA for the oscillator
      SimpleMASignal: false, // Use EMA for the signal line
    });

    const latest = last(macdResult);
    const macdLine = latest.MACD ?? 0;
    const signalLine = latest.signal ?? 0;
    const histogram = latest.histogram ?? 0;

    const trend = histogram > 0 ? 'Bullish' : histogram < 0 ? 'Bearish' : 'Neutral';

    return [
      `MACD(${fastPeriod},${slowPeriod},${signalPeriod}) Analysis:`,
      `MACD Line: ${macdLine.toFixed(4)}`,
      `Signal Line: ${signalLine.toFixed(4)}`,
      `Histogram: ${histogram.toFixed(4)}`,
      `Trend: ${trend}`,
    ].join('\n');
  }

  // ── Bollinger Bands ──────────────────────────────────────────────────────

  calculateBollingerBands(barsJson: string, period: number, stdDev: number): string {
    const bars: Bar[] = JSON.parse(barsJson);
    if (bars.length < period) {
      return `Insufficient data: need at least ${period} bars, got ${bars.length}`;
    }

    const closes = bars.map((b) => b.c);
    const bbResult = BollingerBands.calculate({
      values: closes,
      period,
      stdDev,
    });

    const latest = last(bbResult);
    const { upper, middle, lower } = latest;
    const currentClose = last(closes);

    // %B = (Price - Lower) / (Upper - Lower)
    const percentB = (currentClose - lower) / (upper - lower);
    // Band Width as percentage: (Upper - Lower) / Middle * 100
    const bandWidth = ((upper - lower) / middle) * 100;

    return [
      `Bollinger Bands(${period},${stdDev}) Analysis:`,
      `Upper Band: ${upper.toFixed(2)}`,
      `Middle Band: ${middle.toFixed(2)}`,
      `Lower Band: ${lower.toFixed(2)}`,
      `%B: ${percentB.toFixed(2)}`,
      `Band Width: ${bandWidth.toFixed(2)}`,
      `Price Position: ${this.classifyBollingerPosition(percentB)}`,
    ].join('\n');
  }

  // ── EMA ──────────────────────────────────────────────────────────────────

  calculateEMA(barsJson: string, period: number): string {
    const bars: Bar[] = JSON.parse(barsJson);
    if (bars.length < period) {
      return `Insufficient data: need at least ${period} bars, got ${bars.length}`;
    }

    const closes = bars.map((b) => b.c);
    const emaResult = EMA.calculate({ values: closes, period });
    const emaValue = last(emaResult);
    const currentClose = last(closes);
    const position = currentClose >= emaValue ? 'above' : 'below';

    return [
      `EMA(${period}) Analysis:`,
      `Current EMA(${period}): ${emaValue.toFixed(2)}`,
      `Current Price: ${currentClose.toFixed(2)}`,
      `Price is ${position} EMA(${period})`,
    ].join('\n');
  }

  // ── SMA ──────────────────────────────────────────────────────────────────

  calculateSMA(barsJson: string, period: number): string {
    const bars: Bar[] = JSON.parse(barsJson);
    if (bars.length < period) {
      return `Insufficient data: need at least ${period} bars, got ${bars.length}`;
    }

    const closes = bars.map((b) => b.c);
    const smaResult = SMA.calculate({ values: closes, period });
    const smaValue = last(smaResult);
    const currentClose = last(closes);
    const position = currentClose >= smaValue ? 'above' : 'below';

    return [
      `SMA(${period}) Analysis:`,
      `Current SMA(${period}): ${smaValue.toFixed(2)}`,
      `Current Price: ${currentClose.toFixed(2)}`,
      `Price is ${position} SMA(${period})`,
    ].join('\n');
  }

  // ── ATR ──────────────────────────────────────────────────────────────────

  calculateATR(barsJson: string, period: number): string {
    const bars: Bar[] = JSON.parse(barsJson);
    if (bars.length < period + 1) {
      return `Insufficient data: need at least ${period + 1} bars, got ${bars.length}`;
    }

    const highs = bars.map((b) => b.h);
    const lows = bars.map((b) => b.l);
    const closes = bars.map((b) => b.c);

    const atrResult = ATR.calculate({ high: highs, low: lows, close: closes, period });
    const atrValue = last(atrResult);
    const currentClose = last(closes);
    const atrPercent = (atrValue / currentClose) * 100;

    return [
      `ATR(${period}) Analysis:`,
      `Current ATR(${period}): ${atrValue.toFixed(4)}`,
      `ATR %: ${atrPercent.toFixed(2)}%`,
      `Current Price: ${currentClose.toFixed(2)}`,
      `Volatility: ${this.classifyVolatility(atrPercent)}`,
    ].join('\n');
  }

  // ── Stochastic ───────────────────────────────────────────────────────────

  calculateStochastic(barsJson: string, period: number, signalPeriod: number): string {
    const bars: Bar[] = JSON.parse(barsJson);
    if (bars.length < period + signalPeriod) {
      return `Insufficient data: need at least ${period + signalPeriod} bars, got ${bars.length}`;
    }

    const highs = bars.map((b) => b.h);
    const lows = bars.map((b) => b.l);
    const closes = bars.map((b) => b.c);

    const stochResult = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
      signalPeriod,
    });

    const latest = last(stochResult);
    const { k, d } = latest;

    const zone = this.classifyStochastic(k);

    return [
      `Stochastic(${period},${signalPeriod}) Analysis:`,
      `%K: ${k.toFixed(2)}`,
      `%D: ${d.toFixed(2)}`,
      `Zone: ${zone}`,
    ].join('\n');
  }

  // ── ADX ──────────────────────────────────────────────────────────────────

  calculateADX(barsJson: string, period: number): string {
    const bars: Bar[] = JSON.parse(barsJson);
    // ADX needs 2*period bars minimum for meaningful output
    if (bars.length < 2 * period) {
      return `Insufficient data: need at least ${2 * period} bars, got ${bars.length}`;
    }

    // Manual ADX implementation matching the repository's established baseline.
    //
    // The baseline uses a modified moving average with alpha = 1/period applied
    // from bar 0 with no SMA seed. Key differences from a standard Wilder seed:
    //   1. Bar 0: TR = high - low, +DM = 0, -DM = 0
    //   2. MMA starts from bar 0 value
    //   3. DX computed per-bar from smoothed DI values
    //   4. ADX = MMA(DX) also starts from bar 0's DX value
    //
    // The `technicalindicators` library uses a different seeding approach, which
    // diverges materially on short datasets (30 bars, period 14).
    const { adx: adxValue, plusDI, minusDI } = this.computeAdxBaseline(bars, period);

    const trendStrength = this.classifyADX(adxValue);
    const trendDirection = plusDI > minusDI ? 'Bullish' : 'Bearish';

    return [
      `ADX(${period}) Analysis:`,
      `ADX: ${adxValue.toFixed(2)}`,
      `+DI: ${plusDI.toFixed(2)}`,
      `-DI: ${minusDI.toFixed(2)}`,
      `Trend Strength: ${trendStrength}`,
      `Trend Direction: ${trendDirection}`,
    ].join('\n');
  }

  /**
   * Compute ADX, +DI, -DI matching the repository's baseline algorithm.
   *
   * Chain:
   *   DX -> |+DI - -DI| / (+DI + -DI) * 100
   *   +DI = MMA(+DM, period) / MMA(TR, period) * 100
   *   MMA = EMA with multiplier = 1/period, seeded from bar 0 value
   */
  private computeAdxBaseline(
    bars: Bar[],
    period: number,
  ): { adx: number; plusDI: number; minusDI: number } {
    const alpha = 1.0 / period;
    const n = bars.length;

    // Bar 0: TR = high - low, +DM = 0, -DM = 0.
    const tr: number[] = [bars[0]!.h - bars[0]!.l];
    const pdm: number[] = [0];
    const mdm: number[] = [0];

    for (let i = 1; i < n; i++) {
      const bar = bars[i]!;
      const prevBar = bars[i - 1]!;

      tr.push(Math.max(bar.h - bar.l, Math.abs(bar.h - prevBar.c), Math.abs(bar.l - prevBar.c)));

      const upMove = bar.h - prevBar.h;
      const downMove = prevBar.l - bar.l;

      pdm.push(upMove > downMove && upMove > 0 ? upMove : 0);
      mdm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // Pure EMA (MMA) from bar 0 with no SMA seed.
    const sTR = this.wilderMma(tr, alpha);
    const sPDM = this.wilderMma(pdm, alpha);
    const sMDM = this.wilderMma(mdm, alpha);

    // +DI, -DI, DX per bar
    const dx: number[] = [];
    const pdiArr: number[] = [];
    const mdiArr: number[] = [];

    for (let i = 0; i < n; i++) {
      const trVal = sTR[i]!;
      const pdi = trVal === 0 ? 0 : (100 * sPDM[i]!) / trVal;
      const mdi = trVal === 0 ? 0 : (100 * sMDM[i]!) / trVal;
      pdiArr.push(pdi);
      mdiArr.push(mdi);

      const sum = pdi + mdi;
      dx.push(sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum);
    }

    // ADX = MMA(DX)
    const adxArr = this.wilderMma(dx, alpha);

    return {
      adx: adxArr[n - 1]!,
      plusDI: pdiArr[n - 1]!,
      minusDI: mdiArr[n - 1]!,
    };
  }

  /** Pure EMA (Modified Moving Average): seed = first value, alpha = multiplier. */
  private wilderMma(values: number[], alpha: number): number[] {
    const result: number[] = [values[0]!];
    for (let i = 1; i < values.length; i++) {
      const prev = result[i - 1]!;
      result.push(prev + alpha * (values[i]! - prev));
    }
    return result;
  }

  // ── OBV ──────────────────────────────────────────────────────────────────

  calculateOBV(barsJson: string): string {
    const bars: Bar[] = JSON.parse(barsJson);
    if (bars.length < 2) {
      return `Insufficient data: need at least 2 bars, got ${bars.length}`;
    }

    // Manual OBV calculation using the repository baseline:
    // start with the first bar's volume, then accumulate.
    // The `technicalindicators` library skips the first bar (starts at 0),
    // so we implement manually for exact parity.
    let obv = bars[0]!.v;
    for (let i = 1; i < bars.length; i++) {
      const bar = bars[i]!;
      const prevBar = bars[i - 1]!;
      if (bar.c > prevBar.c) {
        obv += bar.v;
      } else if (bar.c < prevBar.c) {
        obv -= bar.v;
      }
    }

    // Format with commas for readability
    const formatted = obv.toLocaleString('en-US');

    // Compute trend from recent 5 bars
    const recentObvs = this.computeRecentObv(bars);

    return [
      `OBV Analysis:`,
      `Current OBV: ${formatted}`,
      `Trend: ${this.classifyOBVTrend(recentObvs)}`,
    ].join('\n');
  }

  /** Compute OBV values for the last 5 bars (for trend classification). */
  private computeRecentObv(bars: Bar[]): number[] {
    let obv = bars[0]!.v;
    const obvValues: number[] = [obv];
    for (let i = 1; i < bars.length; i++) {
      const bar = bars[i]!;
      const prevBar = bars[i - 1]!;
      if (bar.c > prevBar.c) {
        obv += bar.v;
      } else if (bar.c < prevBar.c) {
        obv -= bar.v;
      }
      obvValues.push(obv);
    }
    return obvValues;
  }

  // ── Classification helpers ───────────────────────────────────────────────

  private classifyRSI(rsi: number): string {
    if (rsi >= 70) return 'Overbought';
    if (rsi <= 30) return 'Oversold';
    if (rsi >= 60) return 'Bullish';
    if (rsi <= 40) return 'Bearish';
    return 'Neutral';
  }

  private interpretRSI(rsi: number): string {
    if (rsi >= 80) return 'Extremely overbought — high reversal risk';
    if (rsi >= 70) return 'Overbought — potential pullback ahead';
    if (rsi <= 20) return 'Extremely oversold — potential bounce ahead';
    if (rsi <= 30) return 'Oversold — potential reversal ahead';
    return 'Neutral momentum';
  }

  private classifyBollingerPosition(percentB: number): string {
    if (percentB > 1) return 'Above upper band (overbought)';
    if (percentB > 0.8) return 'Near upper band';
    if (percentB < 0) return 'Below lower band (oversold)';
    if (percentB < 0.2) return 'Near lower band';
    return 'Within bands';
  }

  private classifyVolatility(atrPercent: number): string {
    if (atrPercent > 5) return 'Extremely High';
    if (atrPercent > 3) return 'High';
    if (atrPercent > 1.5) return 'Moderate';
    if (atrPercent > 0.5) return 'Low';
    return 'Very Low';
  }

  private classifyStochastic(k: number): string {
    if (k >= 80) return 'Overbought';
    if (k <= 20) return 'Oversold';
    return 'Neutral';
  }

  private classifyADX(adx: number): string {
    if (adx >= 75) return 'Extremely Strong Trend';
    if (adx >= 50) return 'Strong Trend';
    if (adx >= 25) return 'Trending';
    return 'Weak/No Trend';
  }

  private classifyOBVTrend(obvValues: number[]): string {
    if (obvValues.length < 5) return 'Insufficient data for trend';
    const recent = obvValues.slice(-5);
    const isRising = recent.every((v, i) => i === 0 || v >= recent[i - 1]!);
    const isFalling = recent.every((v, i) => i === 0 || v <= recent[i - 1]!);
    if (isRising) return 'Rising (confirms uptrend)';
    if (isFalling) return 'Falling (confirms downtrend)';
    return 'Mixed';
  }
}
