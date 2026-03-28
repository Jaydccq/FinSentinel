import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface MarketCalendarServiceStub {
  getUpcomingEarnings(ticker: string): Promise<string>;
  getDividendHistory(ticker: string): Promise<string>;
  getSplitHistory(ticker: string): Promise<string>;
  getIPOCalendar(): Promise<string>;
}

/**
 * Market calendar tools — earnings, dividends, splits, IPOs.
 *
 * Maps to Java MarketCalendarTool (4 methods).
 */
export function createMarketCalendarTools(
  service: MarketCalendarServiceStub,
) {
  return {
    getUpcomingEarnings: tool({
      description:
        'Get upcoming earnings dates and estimates for a stock. ' +
        'Shows report date, EPS estimates, and revenue forecasts. ' +
        'Use before earnings season to assess event-driven risk.',
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. AAPL'),
      }),
      execute: async ({ ticker }) => {
        try {
          return await service.getUpcomingEarnings(ticker);
        } catch (e) {
          return `Error fetching earnings for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getDividendHistory: tool({
      description:
        'Get dividend calendar and history for a stock. ' +
        'Shows ex-dividend dates, payment dates, and dividend amounts. ' +
        'Use for income analysis and dividend capture strategy.',
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. MSFT'),
      }),
      execute: async ({ ticker }) => {
        try {
          return await service.getDividendHistory(ticker);
        } catch (e) {
          return `Error fetching dividend history for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getSplitHistory: tool({
      description:
        'Get stock split history for a ticker. ' +
        'Shows historical split events with ratios and dates.',
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. TSLA'),
      }),
      execute: async ({ ticker }) => {
        try {
          return await service.getSplitHistory(ticker);
        } catch (e) {
          return `Error fetching split history for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getIPOCalendar: tool({
      description:
        'Get upcoming IPO calendar showing companies about to go public. ' +
        'Shows expected date, price range, and underwriters.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.getIPOCalendar();
        } catch (e) {
          return `Error fetching IPO calendar: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
