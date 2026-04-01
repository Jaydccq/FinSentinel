import { Injectable, Logger } from '@nestjs/common';
import type { MarketQuote, MarketBar } from '@finsentinel/shared';
import type { MarketDataProvider } from '../interfaces/market-data-provider';

/** Shape of a single quote from the FMP /quote/{ticker} response. */
interface FmpQuote {
  symbol: string;
  open: number;
  dayHigh: number;
  dayLow: number;
  price: number;
  volume: number;
  timestamp: number;
}

/** Shape of the FMP /historical-price-full/{ticker} response. */
interface FmpHistoricalResponse {
  symbol: string;
  historical: FmpHistoricalBar[];
}

interface FmpHistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Configuration injected into the provider. */
export interface FmpProviderConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * Market-data provider backed by the Financial Modeling Prep (FMP) REST API v3.
 *
 * - Quote: GET /quote/{ticker}?apikey=...
 * - History: GET /historical-price-full/{ticker}?from=...&to=...&apikey=...
 *
 * Auth via `apikey` query parameter on every request.
 */
@Injectable()
export class FmpMarketDataProvider implements MarketDataProvider {
  private readonly logger = new Logger(FmpMarketDataProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: FmpProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  getName(): string {
    return 'fmp';
  }

  supports(_ticker: string): boolean {
    return true;
  }

  async getQuote(ticker: string): Promise<MarketQuote> {
    const url = `${this.baseUrl}/quote/${ticker}?apikey=${this.apiKey}`;

    this.logger.debug(`FMP quote request: ${url.replace(this.apiKey, '***')}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `FMP API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as FmpQuote[];

    if (!data || data.length === 0) {
      throw new Error(`No data available for ticker ${ticker}`);
    }

    const quote = data[0]!;

    return {
      ticker,
      open: quote.open.toFixed(2),
      high: quote.dayHigh.toFixed(2),
      low: quote.dayLow.toFixed(2),
      close: quote.price.toFixed(2),
      volume: quote.volume,
      timestamp: quote.timestamp,
    };
  }

  async getHistoricalBars(ticker: string, days: number): Promise<MarketBar[]> {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);

    const fromStr = this.formatDate(from);
    const toStr = this.formatDate(to);

    const url =
      `${this.baseUrl}/historical-price-full/${ticker}` +
      `?from=${fromStr}&to=${toStr}&apikey=${this.apiKey}`;

    this.logger.debug(
      `FMP history request: ${url.replace(this.apiKey, '***')}`,
    );

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `FMP API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as FmpHistoricalResponse;

    if (!data.historical || data.historical.length === 0) {
      throw new Error(`No historical data available for ticker ${ticker}`);
    }

    // FMP returns bars in reverse chronological order; sort ascending by date
    const sorted = [...data.historical].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    return sorted.map((bar) => ({
      open: bar.open.toFixed(2),
      high: bar.high.toFixed(2),
      low: bar.low.toFixed(2),
      close: bar.close.toFixed(2),
      volume: bar.volume,
      timestamp: new Date(bar.date).getTime(),
    }));
  }

  // ── Internal ────────────────────────────────────────────────────────────

  /** Format a Date as YYYY-MM-DD for FMP's API. */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]!;
  }
}
