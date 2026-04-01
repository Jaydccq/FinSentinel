import { Injectable, Logger } from '@nestjs/common';
import type { MarketQuote, MarketBar } from '@finsentinel/shared';
import type { MarketDataProvider } from '../interfaces/market-data-provider';

/** Yahoo Finance chart API response structure. */
interface YahooChartResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: { code: string; description: string } | null;
  };
}

interface YahooChartResult {
  meta: {
    symbol: string;
    regularMarketPrice: number;
    chartPreviousClose: number;
  };
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
  };
}

/** Configuration injected into the provider. */
export interface YahooProviderConfig {
  baseUrl: string;
}

/**
 * Market-data provider backed by the Yahoo Finance v8 chart API.
 *
 * Free API -- no key needed. Uses User-Agent header to avoid blocks.
 *
 * - Quote: parse meta + last indicator values from chart response
 * - History: parse OHLCV arrays from chart response
 */
@Injectable()
export class YahooFinanceMarketDataProvider implements MarketDataProvider {
  private readonly logger = new Logger(YahooFinanceMarketDataProvider.name);
  private readonly baseUrl: string;

  private static readonly USER_AGENT = 'Mozilla/5.0 FinSentinel/1.0';

  /** Map calendar days to Yahoo range parameter. */
  private static readonly RANGE_MAP: Record<number, string> = {
    5: '5d',
    30: '1mo',
    90: '3mo',
    180: '6mo',
    365: '1y',
  };

  constructor(config: YahooProviderConfig) {
    this.baseUrl = config.baseUrl;
  }

  getName(): string {
    return 'yahoo';
  }

  supports(_ticker: string): boolean {
    return true;
  }

  async getQuote(ticker: string): Promise<MarketQuote> {
    const chartResult = await this.fetchChart(ticker, '5d', '1d');

    const meta = chartResult.meta;
    const timestamps = chartResult.timestamp;
    const quote = chartResult.indicators.quote[0]!;

    // Use the last available data point
    const lastIdx = timestamps.length - 1;

    const open = quote.open[lastIdx];
    const high = quote.high[lastIdx];
    const low = quote.low[lastIdx];
    const close = quote.close[lastIdx];
    const volume = quote.volume[lastIdx];
    const timestamp = timestamps[lastIdx]!;

    if (open == null || high == null || low == null || close == null) {
      throw new Error(`Incomplete quote data for ticker ${ticker}`);
    }

    return {
      ticker,
      open: open.toFixed(2),
      high: high.toFixed(2),
      low: low.toFixed(2),
      close: close.toFixed(2),
      volume: volume ?? 0,
      timestamp: timestamp * 1000, // Yahoo returns seconds; convert to ms
    };
  }

  async getHistoricalBars(ticker: string, days: number): Promise<MarketBar[]> {
    const range = this.daysToRange(days);
    const chartResult = await this.fetchChart(ticker, range, '1d');

    const timestamps = chartResult.timestamp;
    const quote = chartResult.indicators.quote[0]!;
    const bars: MarketBar[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open[i];
      const high = quote.high[i];
      const low = quote.low[i];
      const close = quote.close[i];
      const volume = quote.volume[i];

      // Skip data points with null values (market holidays etc.)
      if (open == null || high == null || low == null || close == null) {
        continue;
      }

      bars.push({
        open: open.toFixed(2),
        high: high.toFixed(2),
        low: low.toFixed(2),
        close: close.toFixed(2),
        volume: volume ?? 0,
        timestamp: timestamps[i]! * 1000, // Yahoo returns seconds; convert to ms
      });
    }

    if (bars.length === 0) {
      throw new Error(`No historical data available for ticker ${ticker}`);
    }

    return bars;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async fetchChart(
    ticker: string,
    range: string,
    interval: string,
  ): Promise<YahooChartResult> {
    const url =
      `${this.baseUrl}/v8/finance/chart/${ticker}` +
      `?interval=${interval}&range=${range}`;

    this.logger.debug(`Yahoo chart request: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': YahooFinanceMarketDataProvider.USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Yahoo Finance API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as YahooChartResponse;

    if (data.chart.error) {
      throw new Error(
        `Yahoo Finance error: ${data.chart.error.description}`,
      );
    }

    if (!data.chart.result || data.chart.result.length === 0) {
      throw new Error(`No data available for ticker ${ticker}`);
    }

    return data.chart.result[0]!;
  }

  /**
   * Convert calendar days to Yahoo's range parameter.
   * Picks the smallest range that covers the requested days.
   */
  private daysToRange(days: number): string {
    if (days <= 5) return '5d';
    if (days <= 30) return '1mo';
    if (days <= 90) return '3mo';
    if (days <= 180) return '6mo';
    return '1y';
  }
}
