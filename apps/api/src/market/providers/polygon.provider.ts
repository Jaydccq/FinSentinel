import { Injectable, Logger } from '@nestjs/common';
import type { MarketQuote, MarketBar, TickerSearchResult } from '@finsentinel/shared';
import { Contract, SecurityType } from '@finsentinel/shared';
import type { MarketDataProvider } from '../interfaces/market-data-provider';

/** Shape of a single bar from the Polygon /v2/aggs response. */
interface PolygonBar {
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  t: number; // timestamp (ms)
}

interface PolygonAggResponse {
  resultsCount: number;
  results: PolygonBar[];
}

/** Configuration injected into the provider. */
export interface PolygonProviderConfig {
  apiKey: string;
}

/**
 * Market-data provider backed by the Polygon.io REST API.
 *
 * - Quote: fetches the last 5 days of bars, returns the most recent one.
 * - History: fetches a date range of daily bars, transforms to MarketBar[].
 */
@Injectable()
export class PolygonMarketDataProvider implements MarketDataProvider {
  private readonly logger = new Logger(PolygonMarketDataProvider.name);
  private readonly apiKey: string;
  private static readonly BASE_URL = 'https://api.polygon.io';

  constructor(config: PolygonProviderConfig) {
    this.apiKey = config.apiKey;
  }

  getName(): string {
    return 'polygon';
  }

  supports(_ticker: string): boolean {
    return true;
  }

  async getQuote(ticker: string): Promise<MarketQuote> {
    // Fetch last 5 days of bars; use the most recent bar as the quote
    const bars = await this.fetchBars(ticker, 5);

    if (!bars.length) {
      throw new Error(`No data available for ticker ${ticker}`);
    }

    const lastBar = bars[bars.length - 1]!;
    return {
      ticker,
      open: lastBar.o.toFixed(2),
      high: lastBar.h.toFixed(2),
      low: lastBar.l.toFixed(2),
      close: lastBar.c.toFixed(2),
      volume: lastBar.v,
      timestamp: lastBar.t,
    };
  }

  async getHistoricalBars(ticker: string, days: number): Promise<MarketBar[]> {
    const bars = await this.fetchBars(ticker, days);

    return bars.map((bar) => ({
      open: bar.o.toFixed(2),
      high: bar.h.toFixed(2),
      low: bar.l.toFixed(2),
      close: bar.c.toFixed(2),
      volume: bar.v,
      timestamp: bar.t,
    }));
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async fetchBars(ticker: string, days: number): Promise<PolygonBar[]> {
    const polygonTicker = this.normalizeTicker(ticker);

    // Use UTC calendar math so CI and local machines produce the same Polygon range.
    const now = new Date();
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - days);

    const fromStr = this.formatDate(from);
    const toStr = this.formatDate(to);

    const url =
      `${PolygonMarketDataProvider.BASE_URL}/v2/aggs/ticker/${polygonTicker}` +
      `/range/1/day/${fromStr}/${toStr}?apiKey=${this.apiKey}`;

    this.logger.debug(`Polygon request: ${url.replace(this.apiKey, '***')}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as PolygonAggResponse;

    if (!data.results || data.results.length === 0) {
      throw new Error(`No data available for ticker ${ticker}`);
    }

    return data.results;
  }

  /** Format a Date as YYYY-MM-DD for Polygon's API. */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]!;
  }

  /**
   * Ticker search backed by the Polygon `/v3/reference/tickers` reference
   * endpoint. Implementing this opts the provider into the registry's
   * `getSearchProvider()` selection so a Polygon-default deployment no
   * longer has to fall back to Yahoo for symbol lookup.
   *
   * See https://polygon.io/docs/stocks/get_v3_reference_tickers
   */
  async searchTickers(query: string, limit: number): Promise<TickerSearchResult[]> {
    const url = new URL(`${PolygonMarketDataProvider.BASE_URL}/v3/reference/tickers`);
    url.searchParams.set('search', query);
    url.searchParams.set('active', 'true');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('apiKey', this.apiKey);

    const safeUrl = url.toString().replace(this.apiKey, '***');
    this.logger.debug(`Polygon search request: ${safeUrl}`);

    const response = await fetch(url.toString());
    if (!response.ok) {
      this.logger.warn(`Polygon search failed: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      results?: Array<{
        ticker: string;
        name: string;
        primary_exchange?: string;
        market?: string;
        type?: string;
      }>;
    };

    return (data.results ?? []).map((row) => ({
      symbol: row.ticker,
      name: row.name,
      exchange: row.primary_exchange ?? row.market ?? 'UNKNOWN',
      assetType: row.type ?? row.market ?? 'EQUITY',
    }));
  }

  private normalizeTicker(ticker: string): string {
    if (ticker.startsWith('X:')) {
      return ticker;
    }

    const contract = Contract.fromString(ticker);
    if (contract.secType === SecurityType.CRYPTO) {
      return `X:${contract.symbol}${contract.currency}`;
    }

    return ticker;
  }
}
