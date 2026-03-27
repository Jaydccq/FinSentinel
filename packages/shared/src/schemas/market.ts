import { z } from 'zod';

// --- MarketQuote ---
export const marketQuoteSchema = z.object({
  ticker: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.number().int(),
  timestamp: z.number().int(),
});
export type MarketQuote = z.infer<typeof marketQuoteSchema>;

// --- MarketBar ---
export const marketBarSchema = z.object({
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.number().int(),
  timestamp: z.number().int(),
});
export type MarketBar = z.infer<typeof marketBarSchema>;

// --- TickerSearchResult ---
export const tickerSearchResultSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string(),
  assetType: z.string(),
});
export type TickerSearchResult = z.infer<typeof tickerSearchResultSchema>;
