import { tool } from 'ai';
import { z } from 'zod';
import { MarketCalendarService } from '../../market/market-calendar.service';

/**
 * Market calendar tools — earnings, dividends, splits, IPOs.
 *
 * Market-calendar tool surface exposed to the agent.
 */
export function createMarketCalendarTools(
  service: MarketCalendarService,
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
          return JSON.stringify(await service.getUpcomingEarnings(ticker), null, 2);
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
          return JSON.stringify(await service.getDividendHistory(ticker), null, 2);
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
          return JSON.stringify(await service.getSplitHistory(ticker), null, 2);
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
          return JSON.stringify(await service.getIPOCalendar(), null, 2);
        } catch (e) {
          return `Error fetching IPO calendar: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
