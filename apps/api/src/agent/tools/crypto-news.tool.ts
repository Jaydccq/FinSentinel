import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';
import { CryptoToolsService } from '../crypto-tools.service';

/**
 * Crypto news tools — real-time news from 6551 API with AI scoring.
 *
 * Gated by APP_CRYPTO_NEWS_ENABLED=true.
 *
 * Crypto-news tool surface exposed to the agent.
 */
export function createCryptoNewsTools(service: CryptoToolsService) {
  return {
    getCryptoNews: tool({
      description:
        'Search real-time crypto news articles from the 6551 API. ' +
        'Returns articles with AI-generated scores, grades, trading signals, and summaries. ' +
        'Use this to understand current crypto market sentiment and breaking news for a coin or topic.',
      inputSchema: z.object({
        keyword: z.string().describe("Search keyword, e.g. 'bitcoin ETF' or 'ethereum merge'"),
        coin: z
          .string()
          .optional()
          .describe("Coin symbol filter, e.g. 'BTC' or 'ETH', or omit for all coins"),
        minScore: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe('Minimum AI rating score (0-100) to filter low-quality articles'),
        limit: z.number().int().min(1).max(20).describe('Number of articles to return (1-20)'),
      }),
      execute: async ({ keyword, coin, minScore, limit }) => {
        try {
          return await service.getCryptoNews(keyword, coin, minScore, limit);
        } catch (e) {
          return `Error fetching crypto news: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getCryptoNewsBySignal: tool({
      description:
        'Get crypto news articles filtered by AI-generated trading signal (long, short, or neutral). ' +
        'Returns only articles where AI analysis is complete and matches the requested signal. ' +
        'Use this to find news supporting a specific market direction thesis.',
      inputSchema: z.object({
        signal: z
          .enum(['long', 'short', 'neutral'])
          .describe("Trading signal filter: 'long', 'short', or 'neutral'"),
        limit: z.number().int().min(1).max(10).describe('Number of articles to return (1-10)'),
      }),
      execute: async ({ signal, limit }) => {
        try {
          return await service.getCryptoNewsBySignal(signal, limit);
        } catch (e) {
          return `Error fetching crypto news by signal: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
