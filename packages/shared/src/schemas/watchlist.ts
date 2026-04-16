import { z } from 'zod';

export const watchlistItemResponseSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string(),
  companyName: z.string(),
  thesis: z.string(),
  notes: z.string(),
  priority: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WatchlistItemResponse = z.infer<typeof watchlistItemResponseSchema>;

export const watchlistCategoryResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
  summary: z.string(),
  itemCount: z.number().int(),
  items: z.array(watchlistItemResponseSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WatchlistCategoryResponse = z.infer<typeof watchlistCategoryResponseSchema>;

export const watchlistOverviewResponseSchema = z.object({
  categories: z.array(watchlistCategoryResponseSchema),
});
export type WatchlistOverviewResponse = z.infer<typeof watchlistOverviewResponseSchema>;
