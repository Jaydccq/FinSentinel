import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';
import { WatchlistService } from '../../watchlist/watchlist.service';

const watchlistItemSchema = z.object({
  symbol: z.string().min(1).describe('Ticker symbol, e.g. NVDA or XOM'),
  companyName: z.string().optional().describe('Optional company name'),
  thesis: z.string().optional().describe('Short reason the stock belongs in this category'),
  notes: z.string().optional().describe('Free-form notes, catalysts, or follow-up items'),
  priority: z.number().int().min(0).max(100).optional().describe('Higher means more important'),
});

export function createWatchlistTools(service: WatchlistService, userId: string) {
  return {
    saveWatchlistItems: tool({
      description:
        "Persist one or more stocks into the user's watchlist under a named category such as 电, 光, 油, AI, or software. " +
        'Use this whenever the user asks you to remember, add, bucket, or maintain observation names across sessions.',
      inputSchema: z.object({
        categoryName: z.string().min(1).describe('Watchlist category name'),
        categoryDescription: z.string().optional().describe('Optional category description'),
        categorySummary: z
          .string()
          .optional()
          .describe('Optional summary of why this category matters'),
        items: z.array(watchlistItemSchema).min(1).describe('Stocks to save into this category'),
      }),
      execute: async ({ categoryName, categoryDescription, categorySummary, items }) => {
        try {
          return await service.saveWatchlistItems(userId, {
            categoryName,
            categoryDescription,
            categorySummary,
            items,
          });
        } catch (error) {
          return `Error saving watchlist items: ${error instanceof Error ? error.message : 'unknown'}`;
        }
      },
    }),

    getWatchlist: tool({
      description:
        "Read the user's persisted watchlist categories and items. " +
        'Use this before answering questions about saved observation stocks or category organization.',
      inputSchema: z.object({
        categoryName: z.string().optional().describe('Optional category filter'),
      }),
      execute: async ({ categoryName }) => {
        try {
          return await service.getWatchlist(userId, categoryName);
        } catch (error) {
          return `Error loading watchlist: ${error instanceof Error ? error.message : 'unknown'}`;
        }
      },
    }),

    organizeWatchlistCategory: tool({
      description:
        'Update category-level organization for a watchlist bucket, including summary, item priorities, and refreshed notes. ' +
        'Use this after learning a better organizing thesis from the user or after consolidating a category.',
      inputSchema: z.object({
        categoryName: z.string().min(1).describe('Existing or new category name'),
        categoryDescription: z.string().optional().describe('Optional category description'),
        categorySummary: z
          .string()
          .optional()
          .describe('Summary of the category thesis or sorting logic'),
        items: z
          .array(watchlistItemSchema)
          .optional()
          .describe('Optional item updates within the category'),
      }),
      execute: async ({ categoryName, categoryDescription, categorySummary, items }) => {
        try {
          return await service.organizeWatchlistCategory(userId, {
            categoryName,
            categoryDescription,
            categorySummary,
            items,
          });
        } catch (error) {
          return `Error organizing watchlist: ${error instanceof Error ? error.message : 'unknown'}`;
        }
      },
    }),
  };
}
