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

// ── Request inputs (REST DTOs) ────────────────────────────────────────────

export const saveWatchlistItemSchema = z.object({
  symbol: z.string().min(1).max(50),
  companyName: z.string().max(255).optional(),
  thesis: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});
export type SaveWatchlistItemInput = z.infer<typeof saveWatchlistItemSchema>;

export const saveWatchlistRequestSchema = z.object({
  categoryName: z.string().min(1).max(100),
  categoryDescription: z.string().max(1000).optional(),
  categorySummary: z.string().max(2000).optional(),
  items: z.array(saveWatchlistItemSchema).max(500),
});
export type SaveWatchlistRequest = z.infer<typeof saveWatchlistRequestSchema>;

// F-6: item + category level mutations. Patch bodies are all-optional —
// the controller rejects the request if every field is missing so we
// don't waste a DB round-trip on no-ops.
export const updateWatchlistItemRequestSchema = z.object({
  companyName: z.string().max(255).optional(),
  thesis: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});
export type UpdateWatchlistItemRequest = z.infer<typeof updateWatchlistItemRequestSchema>;

export const updateWatchlistCategoryRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  summary: z.string().max(2000).optional(),
});
export type UpdateWatchlistCategoryRequest = z.infer<typeof updateWatchlistCategoryRequestSchema>;
