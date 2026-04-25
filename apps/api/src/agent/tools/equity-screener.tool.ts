import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';
import { EquityScreenerService } from '../../research/equity-screener.service';

/**
 * Equity discovery and screening tools — stock screener, market movers, search.
 *
 * Equity-screener tool surface exposed to the agent.
 */
export function createEquityScreenerTools(service: EquityScreenerService) {
  return {
    screenStocks: tool({
      description:
        'Screen for stocks matching specific criteria such as exchange, market cap range, ' +
        "or name search. Use when the user asks 'find large cap tech stocks', 'show me NASDAQ stocks " +
        "with market cap over $10B', or 'screen for small-cap stocks on NYSE'. " +
        'All parameters are optional — omit any you do not need.',
      inputSchema: z.object({
        sector: z
          .string()
          .optional()
          .describe("Sector filter, e.g. 'Technology', 'Healthcare', 'Finance'. Optional."),
        exchange: z
          .string()
          .optional()
          .describe("Exchange filter: 'NYSE', 'NASDAQ', 'AMEX'. Optional."),
        marketCapMin: z
          .string()
          .optional()
          .describe("Minimum market cap in dollars, e.g. '10000000000' for $10B. Optional."),
        marketCapMax: z
          .string()
          .optional()
          .describe("Maximum market cap in dollars, e.g. '50000000000' for $50B. Optional."),
        search: z
          .string()
          .optional()
          .describe("Search keyword for company name or ticker, e.g. 'apple', 'semi'. Optional."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Max number of results to return, 1-50. Defaults to 20.'),
      }),
      execute: async ({ sector, exchange, marketCapMin, marketCapMax, search, limit }) => {
        try {
          return JSON.stringify(
            await service.screenStocks(
              sector,
              exchange,
              marketCapMin,
              marketCapMax,
              search,
              limit ?? 20,
            ),
            null,
            2,
          );
        } catch (e) {
          return `Error screening stocks: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getMarketMovers: tool({
      description:
        "Get today's top market movers — gainers, losers, or most actively traded stocks. " +
        "Use when the user asks 'what stocks are up today?', 'show me the biggest losers', " +
        "'which stocks have the most volume today?', or 'what's moving in the market?'.",
      inputSchema: z.object({
        type: z
          .enum(['gainers', 'losers', 'most_active'])
          .describe(
            "Type of movers: 'gainers' (top price increases), " +
              "'losers' (top price decreases), or 'most_active' (highest volume). " +
              "Defaults to 'gainers'.",
          ),
      }),
      execute: async ({ type }) => {
        try {
          return JSON.stringify(await service.getMarketMovers(type), null, 2);
        } catch (e) {
          return `Error fetching market movers: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    searchStocks: tool({
      description:
        'Search for stocks by name or ticker keyword. Use when the user says ' +
        "'find stocks related to semiconductors', 'search for Amazon', 'look up TSLA', " +
        'or needs to discover tickers for a particular company or industry.',
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'Search query — company name, ticker, or keyword. ' +
              "Examples: 'tesla', 'AAPL', 'semiconductor', 'artificial intelligence'.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Max results to return, 1-50. Defaults to 10.'),
      }),
      execute: async ({ query, limit }) => {
        try {
          return JSON.stringify(await service.searchStocks(query, limit ?? 10), null, 2);
        } catch (e) {
          return `Error searching for stocks: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
