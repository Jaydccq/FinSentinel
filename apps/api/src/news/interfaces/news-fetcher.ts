/**
 * Raw news item returned by a NewsFetcher before DB persistence.
 */
export interface RawNewsItem {
  sourceId: string;
  source: string;
  title: string;
  summary: string | null;
  articleUrl: string | null;
  author: string | null;
  publishedAt: string; // ISO datetime
  tickers: string[];
  tags: string[];
}

/**
 * NewsFetcher interface — each news source (Polygon, RSS, 6551.io, etc.)
 * implements this contract. Fetchers are auto-discovered via DI injection.
 */
export interface NewsFetcher {
  /** Unique source identifier, e.g. 'POLYGON', 'RSS_CNBC', 'CRYPTO_6551' */
  getSource(): string;

  /** Fetch raw news items, optionally filtered by tickers */
  fetch(tickers: string[]): Promise<RawNewsItem[]>;
}
