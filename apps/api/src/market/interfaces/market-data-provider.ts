import type { MarketQuote, MarketBar } from '@finsentinel/shared';

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
}
