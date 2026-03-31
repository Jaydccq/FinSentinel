/**
 * Ticker-to-sector mapping table.
 *
 * Covers major US equities across all 11 GICS sectors.
 */
const TICKER_SECTOR_MAP: Record<string, string> = {
  // Technology
  AAPL: 'Technology',
  MSFT: 'Technology',
  GOOGL: 'Technology',
  META: 'Technology',
  NVDA: 'Technology',
  AMD: 'Technology',
  INTC: 'Technology',
  TSM: 'Technology',
  AVGO: 'Technology',

  // Financials
  JPM: 'Financials',
  BAC: 'Financials',
  GS: 'Financials',

  // Healthcare
  JNJ: 'Healthcare',
  PFE: 'Healthcare',
  UNH: 'Healthcare',

  // Energy
  XOM: 'Energy',
  CVX: 'Energy',

  // Consumer Discretionary
  AMZN: 'Consumer Discretionary',
  WMT: 'Consumer Discretionary',
  HD: 'Consumer Discretionary',
  TSLA: 'Consumer Discretionary',

  // Consumer Staples
  PG: 'Consumer Staples',
  KO: 'Consumer Staples',
  PEP: 'Consumer Staples',

  // Utilities
  NEE: 'Utilities',
  DUK: 'Utilities',

  // Real Estate
  PLD: 'Real Estate',
  AMT: 'Real Estate',

  // Industrials
  LMT: 'Industrials',
  BA: 'Industrials',

  // Communication Services
  T: 'Communication Services',
  VZ: 'Communication Services',
};

/**
 * Maps a stock ticker symbol to its GICS sector.
 *
 * Case-insensitive lookup. Returns "Unknown" for unrecognized tickers.
 *
 * @param ticker - the stock ticker symbol (e.g. "AAPL", "JPM")
 * @returns the sector name, or "Unknown" if the ticker is not in the map
 */
export function fromTicker(ticker: string): string {
  return TICKER_SECTOR_MAP[ticker.toUpperCase()] ?? 'Unknown';
}
