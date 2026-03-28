import { tool } from 'ai';
import { z } from 'zod';
import type { TechnicalIndicatorsService } from '../../market/technical-indicators.service';

/**
 * Technical indicator tools — fully wired to TechnicalIndicatorsService.
 *
 * Maps to Java TechnicalIndicatorTool (9 methods).
 */
export function createTechnicalIndicatorTools(
  technicalIndicatorsService: TechnicalIndicatorsService,
) {
  return {
    calculateRSI: tool({
      description:
        'Calculate RSI (Relative Strength Index) from historical price data. ' +
        'RSI > 70 = overbought (bearish signal), RSI < 30 = oversold (bullish signal). ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
        period: z.number().int().describe('RSI period, typically 14'),
      }),
      execute: async ({ barsJson, period }) => {
        try {
          return technicalIndicatorsService.calculateRSI(barsJson, period);
        } catch (e) {
          return `Error calculating RSI: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateMACD: tool({
      description:
        'Calculate MACD (Moving Average Convergence Divergence) from historical price data. ' +
        'MACD above signal line = bullish, below = bearish. Histogram shows momentum strength. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z.string().describe('JSON array of price bars'),
        shortPeriod: z.number().int().describe('Short EMA period, typically 12'),
        longPeriod: z.number().int().describe('Long EMA period, typically 26'),
        signalPeriod: z
          .number()
          .int()
          .describe('Signal line EMA period, typically 9'),
      }),
      execute: async ({ barsJson, shortPeriod, longPeriod, signalPeriod }) => {
        try {
          return technicalIndicatorsService.calculateMACD(
            barsJson,
            shortPeriod,
            longPeriod,
            signalPeriod,
          );
        } catch (e) {
          return `Error calculating MACD: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateBollingerBands: tool({
      description:
        'Calculate Bollinger Bands from historical price data. ' +
        'Price near upper band = potential resistance, near lower band = potential support. ' +
        'Band width indicates volatility. Input is JSON array of OHLCV bars.',
      inputSchema: z.object({
        barsJson: z.string().describe('JSON array of price bars'),
        period: z.number().int().describe('SMA period, typically 20'),
        stdDevMultiplier: z
          .number()
          .describe('Standard deviation multiplier, typically 2.0'),
      }),
      execute: async ({ barsJson, period, stdDevMultiplier }) => {
        try {
          return technicalIndicatorsService.calculateBollingerBands(
            barsJson,
            period,
            stdDevMultiplier,
          );
        } catch (e) {
          return `Error calculating Bollinger Bands: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateEMA: tool({
      description:
        'Calculate EMA (Exponential Moving Average) from historical price data. ' +
        'EMA reacts faster to recent price changes than SMA. ' +
        'Price above EMA = bullish trend, price below EMA = bearish trend. ' +
        'Useful for identifying trend direction and dynamic support/resistance levels. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
        period: z
          .number()
          .int()
          .describe(
            'EMA period (common: 9 for short-term, 21 for medium, 50 or 200 for long-term)',
          ),
      }),
      execute: async ({ barsJson, period }) => {
        try {
          return technicalIndicatorsService.calculateEMA(barsJson, period);
        } catch (e) {
          return `Error calculating EMA: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateSMA: tool({
      description:
        'Calculate SMA (Simple Moving Average) from historical price data. ' +
        'Price above SMA = uptrend, below SMA = downtrend. ' +
        'Also detects Golden Cross (SMA50 crosses above SMA200 = strong bullish) and ' +
        'Death Cross (SMA50 crosses below SMA200 = strong bearish) when enough data is available. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
        period: z
          .number()
          .int()
          .describe('SMA period (common: 20, 50, 100, 200)'),
      }),
      execute: async ({ barsJson, period }) => {
        try {
          return technicalIndicatorsService.calculateSMA(barsJson, period);
        } catch (e) {
          return `Error calculating SMA: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateATR: tool({
      description:
        'Calculate ATR (Average True Range) from historical price data. ' +
        'ATR measures market volatility — higher ATR means more volatile (riskier) asset. ' +
        'ATR as percentage of price provides normalized volatility for cross-asset comparison. ' +
        'High ATR = high risk/reward, Low ATR = stable/low risk. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
        period: z.number().int().describe('ATR period, typically 14'),
      }),
      execute: async ({ barsJson, period }) => {
        try {
          return technicalIndicatorsService.calculateATR(barsJson, period);
        } catch (e) {
          return `Error calculating ATR: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateStochastic: tool({
      description:
        'Calculate Stochastic Oscillator from historical price data. ' +
        'Measures momentum by comparing closing price to price range over a period. ' +
        '%K > 80 = overbought (bearish signal), %K < 20 = oversold (bullish signal). ' +
        '%K crossing above %D = bullish, %K crossing below %D = bearish. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
        kPeriod: z
          .number()
          .int()
          .describe('%K period (lookback window), typically 14'),
        dPeriod: z
          .number()
          .int()
          .describe('%D period (%K smoothing), typically 3'),
      }),
      execute: async ({ barsJson, kPeriod, dPeriod }) => {
        try {
          return technicalIndicatorsService.calculateStochastic(
            barsJson,
            kPeriod,
            dPeriod,
          );
        } catch (e) {
          return `Error calculating Stochastic Oscillator: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateADX: tool({
      description:
        'Calculate ADX (Average Directional Index) from historical price data. ' +
        'ADX measures trend strength regardless of direction. ' +
        'ADX > 25 = strong trend, ADX < 20 = weak/no trend, ADX > 50 = very strong trend. ' +
        '+DI > -DI = bullish trend direction, -DI > +DI = bearish trend direction. ' +
        'Useful for risk assessment: strong trends are more predictable. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
        period: z.number().int().describe('ADX period, typically 14'),
      }),
      execute: async ({ barsJson, period }) => {
        try {
          return technicalIndicatorsService.calculateADX(barsJson, period);
        } catch (e) {
          return `Error calculating ADX: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateOBV: tool({
      description:
        'Calculate OBV (On-Balance Volume) from historical price data. ' +
        'OBV uses volume flow to predict price changes — volume precedes price. ' +
        'Rising OBV + rising price = confirmed uptrend (strong). ' +
        'Rising OBV + falling price = accumulation / bullish divergence (potential reversal up). ' +
        'Falling OBV + rising price = distribution / bearish divergence (potential reversal down). ' +
        'Falling OBV + falling price = confirmed downtrend (weak). ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
      }),
      execute: async ({ barsJson }) => {
        try {
          return technicalIndicatorsService.calculateOBV(barsJson);
        } catch (e) {
          return `Error calculating OBV: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
