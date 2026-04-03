import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface OwnershipServiceStub {
  getInstitutionalHolders(ticker: string): Promise<unknown>;
  getInsiderTransactions(ticker: string): Promise<unknown>;
}

/**
 * Ownership data tools — institutional holders and insider transactions.
 *
 * Ownership-data tool surface exposed to the agent.
 */
export function createOwnershipTools(service: OwnershipServiceStub) {
  return {
    getInstitutionalHolders: tool({
      description:
        'Get institutional holders for a stock (13F filings). ' +
        'Shows top institutional investors, number of shares held, and portfolio weight. ' +
        'Use to assess institutional confidence and potential large block moves.',
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. AAPL'),
      }),
      execute: async ({ ticker }) => {
        try {
          return JSON.stringify(
            await service.getInstitutionalHolders(ticker),
            null,
            2,
          );
        } catch (e) {
          return `Error fetching institutional holders for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getInsiderTransactions: tool({
      description:
        'Get insider trading activity for a stock (SEC Form 4 filings). ' +
        'Shows recent insider buys/sells with dates, amounts, and insider roles. ' +
        'Use to gauge management sentiment — insider buying is a bullish signal.',
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. TSLA'),
      }),
      execute: async ({ ticker }) => {
        try {
          return JSON.stringify(
            await service.getInsiderTransactions(ticker),
            null,
            2,
          );
        } catch (e) {
          return `Error fetching insider transactions for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
