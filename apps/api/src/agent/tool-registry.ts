import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { tool, type ToolSet } from 'ai';
import { MarketDataService } from '../market/market-data.service';
import { TechnicalIndicatorsService } from '../market/technical-indicators.service';

/**
 * Builds the tools object per-request, injecting userId via closure for
 * user-scoped tools. Stateless tools (market data, technical indicators)
 * are always included. User-scoped tools will be added incrementally as
 * their backing services are built.
 */
@Injectable()
export class ToolRegistry {
  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly technicalIndicatorsService: TechnicalIndicatorsService,
  ) {}

  /**
   * Build the full tools object for the primary risk agent.
   * @param userId  The authenticated user's ID (injected into user-scoped tools via closure)
   * @param portfolioId  Optional portfolio ID for portfolio-scoped tools
   */
  buildTools(userId: string, portfolioId?: string): ToolSet {
    return {
      ...this.createMarketDataTools(),
      ...this.createTechnicalIndicatorTools(),
      // TODO: add news tools when NewsService exists
      // TODO: add RAG tools when RagRetrievalService exists
      // TODO: add portfolio tools when PortfolioService exists (userId, portfolioId)
      // TODO: add trading tools when PaperTradingService exists (userId)
      // TODO: add brain tools when AgentBrainService exists (userId)
      // TODO: add autonomy tools when AutonomyService exists (userId)
    };
  }

  /**
   * Build the lightweight tool subset for the secondary stock-analysis agent.
   * Only market data + technical indicators — no user-scoped tools.
   */
  buildStockAnalysisTools(): ToolSet {
    return {
      ...this.createMarketDataTools(),
      ...this.createTechnicalIndicatorTools(),
      // TODO: add newsAnalysis, ownership, shortInterest when services exist
    };
  }

  // ── Market Data Tools ──────────────────────────────────────────────────────

  private createMarketDataTools(): ToolSet {
    const mds = this.marketDataService;

    return {
      getStockQuote: tool({
        description:
          'Get real-time stock quote (price, volume, OHLC) for a given ticker symbol from Polygon.io.',
        inputSchema: z.object({
          ticker: z.string().describe('Stock ticker symbol, e.g. AAPL, MSFT, GOOGL'),
        }),
        execute: async ({ ticker }) => {
          const quote = await mds.getQuote(ticker);
          return JSON.stringify(quote);
        },
      }),

      getHistoricalPrices: tool({
        description:
          'Get historical daily OHLCV bars for technical analysis. Returns an array of bars with open, high, low, close, volume, and timestamp.',
        inputSchema: z.object({
          ticker: z.string().describe('Stock ticker symbol'),
          days: z.number().describe('Number of historical days to fetch (e.g. 30, 60, 90)'),
        }),
        execute: async ({ ticker, days }) => {
          const bars = await mds.getHistoricalBars(ticker, days);
          return JSON.stringify(bars);
        },
      }),

      searchAssets: tool({
        description:
          'Search for tradeable assets by keyword. Returns matching ticker symbols with name, exchange, and asset type.',
        inputSchema: z.object({
          query: z.string().describe('Search query (company name, ticker fragment, etc.)'),
        }),
        execute: async ({ query }) => {
          const results = await mds.searchTickers(query);
          return JSON.stringify(results);
        },
      }),
    };
  }

  // ── Technical Indicator Tools ──────────────────────────────────────────────

  private createTechnicalIndicatorTools(): ToolSet {
    const ti = this.technicalIndicatorsService;

    return {
      calculateRSI: tool({
        description:
          'Calculate Relative Strength Index (RSI) — a momentum indicator measuring overbought/oversold conditions.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          period: z.number().describe('RSI period, typically 14'),
        }),
        execute: async ({ barsJson, period }) => ti.calculateRSI(barsJson, period),
      }),

      calculateMACD: tool({
        description:
          'Calculate MACD (Moving Average Convergence Divergence) — a trend-following momentum indicator.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          fastPeriod: z.number().describe('Fast EMA period, typically 12'),
          slowPeriod: z.number().describe('Slow EMA period, typically 26'),
          signalPeriod: z.number().describe('Signal line period, typically 9'),
        }),
        execute: async ({ barsJson, fastPeriod, slowPeriod, signalPeriod }) =>
          ti.calculateMACD(barsJson, fastPeriod, slowPeriod, signalPeriod),
      }),

      calculateBollingerBands: tool({
        description:
          'Calculate Bollinger Bands — a volatility indicator showing price relative to moving average bands.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          period: z.number().describe('Moving average period, typically 20'),
          stdDev: z.number().describe('Standard deviation multiplier, typically 2'),
        }),
        execute: async ({ barsJson, period, stdDev }) =>
          ti.calculateBollingerBands(barsJson, period, stdDev),
      }),

      calculateEMA: tool({
        description:
          'Calculate Exponential Moving Average (EMA) — a trend-following indicator with faster response to recent prices.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          period: z.number().describe('EMA period (e.g. 12, 26, 50, 200)'),
        }),
        execute: async ({ barsJson, period }) => ti.calculateEMA(barsJson, period),
      }),

      calculateSMA: tool({
        description:
          'Calculate Simple Moving Average (SMA) with Golden/Death Cross detection.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          period: z.number().describe('SMA period (e.g. 50, 200)'),
        }),
        execute: async ({ barsJson, period }) => ti.calculateSMA(barsJson, period),
      }),

      calculateATR: tool({
        description:
          'Calculate Average True Range (ATR) — a volatility indicator used for position sizing and stop-loss placement.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          period: z.number().describe('ATR period, typically 14'),
        }),
        execute: async ({ barsJson, period }) => ti.calculateATR(barsJson, period),
      }),

      calculateStochastic: tool({
        description:
          'Calculate Stochastic Oscillator — a momentum indicator showing overbought/oversold zones via %K and %D.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          period: z.number().describe('Lookback period, typically 14'),
          signalPeriod: z.number().describe('Signal smoothing period, typically 3'),
        }),
        execute: async ({ barsJson, period, signalPeriod }) =>
          ti.calculateStochastic(barsJson, period, signalPeriod),
      }),

      calculateADX: tool({
        description:
          'Calculate Average Directional Index (ADX) — measures trend strength from 0-100.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
          period: z.number().describe('ADX period, typically 14'),
        }),
        execute: async ({ barsJson, period }) => ti.calculateADX(barsJson, period),
      }),

      calculateOBV: tool({
        description:
          'Calculate On-Balance Volume (OBV) — a volume-confirmed trend analysis indicator.',
        inputSchema: z.object({
          barsJson: z.string().describe('JSON string of OHLCV bars from getHistoricalPrices'),
        }),
        execute: async ({ barsJson }) => ti.calculateOBV(barsJson),
      }),
    };
  }
}
