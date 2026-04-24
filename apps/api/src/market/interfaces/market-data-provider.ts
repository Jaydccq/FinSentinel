import type { MarketQuote, MarketBar, TickerSearchResult } from '@finsentinel/shared';

/**
 * Contract for market-data providers (Polygon, Alpaca, etc.).
 *
 * Each provider is auto-discovered by the registry and indexed by name.
 */
export interface MarketDataProvider {
  /** Unique provider identifier, e.g. "polygon". */
  getName(): string;

  /** Fetch the latest quote for a ticker. */
  getQuote(ticker: string): Promise<MarketQuote>;

  /** Fetch historical OHLCV bars for the given number of calendar days. */
  getHistoricalBars(ticker: string, days: number): Promise<MarketBar[]>;

  /** Whether this provider supports the given ticker. Default: true. */
  supports(ticker: string): boolean;

  /**
   * Optional ticker search. Implementing this opts the provider into the
   * registry's `getSearchProvider()` selection. Implementations should treat
   * the `query` string as already normalised (trimmed + lowercased) by the
   * caller.
   */
  searchTickers?(query: string, limit: number): Promise<TickerSearchResult[]>;
}
