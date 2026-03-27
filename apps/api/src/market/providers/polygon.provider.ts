import { Injectable, Logger } from '@nestjs/common';
import type { MarketQuote, MarketBar } from '@finsentinel/shared';
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
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);

    const fromStr = this.formatDate(from);
    const toStr = this.formatDate(to);

    const url =
      `${PolygonMarketDataProvider.BASE_URL}/v2/aggs/ticker/${ticker}` +
      `/range/1/day/${fromStr}/${toStr}?apiKey=${this.apiKey}`;

    this.logger.debug(`Polygon request: ${url.replace(this.apiKey, '***')}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Polygon API error: ${response.status} ${response.statusText}`,
      );
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
}
