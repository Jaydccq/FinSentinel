import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';

// TODO: wire when service exists
interface ShortInterestServiceStub {
  getShortInterest(ticker: string): Promise<string>;
  getFailsToDeliver(ticker: string): Promise<string>;
}

/**
 * Short-interest and fails-to-deliver tools.
 *
 * Short-interest tool surface exposed to the agent.
 */
export function createShortInterestTools(service: ShortInterestServiceStub) {
  return {
    getShortInterest: tool({
      description:
        'Get short interest data for a stock — shows short volume, total volume, ' +
        'and short ratio. High short interest (>20%) may indicate bearish sentiment or ' +
        'potential short squeeze. Data is bi-weekly with ~2 week delay.',
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. GME'),
      }),
      execute: async ({ ticker }) => {
        try {
          return await service.getShortInterest(ticker);
        } catch (e) {
          return `Error fetching short interest for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getFailsToDeliver: tool({
      description:
        'Get fails-to-deliver (FTD) data for a stock from SEC. ' +
        'High FTD counts may indicate settlement issues or naked shorting pressure. ' +
        'Data is monthly with ~1 month delay.',
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. AMC'),
      }),
      execute: async ({ ticker }) => {
        try {
          return await service.getFailsToDeliver(ticker);
        } catch (e) {
          return `Error fetching fails-to-deliver for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
