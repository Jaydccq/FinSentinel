import { z } from 'zod';
import { NewsSource } from '../enums';

const newsSourceValues = Object.values(NewsSource) as [string, ...string[]];

// --- NewsItemResponse ---
export const newsItemResponseSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string(),
  source: z.enum(newsSourceValues),
  title: z.string(),
  summary: z.string(),
  articleUrl: z.string(),
  author: z.string(),
  publishedAt: z.string().datetime(),
  tickers: z.array(z.string()),
  tags: z.array(z.string()),
  sentiment: z.string(),
  enriched: z.boolean(),
});
export type NewsItemResponse = z.infer<typeof newsItemResponseSchema>;

// --- NewsFeedStatsResponse ---
export const newsFeedStatsResponseSchema = z.object({
  todayCount: z.number().int(),
  totalCount: z.number().int(),
  countBySource: z.record(z.string(), z.number().int()),
});
export type NewsFeedStatsResponse = z.infer<typeof newsFeedStatsResponseSchema>;

// --- NewsSummaryResponse ---
export const newsSummaryResponseSchema = z.object({
  ticker: z.string(),
  summary: z.string(),
  articleCount: z.number().int(),
  generatedAt: z.string().datetime(),
});
export type NewsSummaryResponse = z.infer<typeof newsSummaryResponseSchema>;
