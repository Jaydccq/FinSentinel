import { tool } from 'ai';
import { z } from 'zod';
import type { MarketDataService } from '../../market/market-data.service';

/**
 * Stock market data tools — fully wired to MarketDataService.
 *
 * Stock-market tool surface exposed to the agent.
 */
export function createStockMarketTools(marketDataService: MarketDataService) {
  return {
    getStockQuote: tool({
      description:
        'Get real-time stock market data for a given ticker symbol. ' +
        'Returns current price, open, high, low, close, and volume. ' +
        'Use this when you need current market data for risk assessment.',
      inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol, e.g. AAPL, MSFT, TSLA'),
      }),
      execute: async ({ ticker }) => {
        try {
          const quote = await marketDataService.getQuote(ticker);
          return JSON.stringify(quote);
        } catch (e) {
          return `Error fetching stock data for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getHistoricalPrices: tool({
      description:
        'Get historical stock price data (daily bars) for technical analysis. ' +
        'Returns OHLCV bars for the specified number of days.',
      inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .describe('Number of days of historical data (max 365)'),
      }),
      execute: async ({ ticker, days }) => {
        try {
          const bars = await marketDataService.getHistoricalBars(ticker, days);
          return JSON.stringify(bars);
        } catch (e) {
          return `Error fetching historical data for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
