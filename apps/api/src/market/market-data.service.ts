import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { MarketQuote, MarketBar, TickerSearchResult } from '@finsentinel/shared';
import { MarketDataProviderRegistry } from './market-data-provider.registry';

/** Cache TTLs in seconds. */
const CACHE_TTL = {
  QUOTE: 300,       // 5 minutes
  BARS: 1800,       // 30 minutes
  SEARCH: 600,      // 10 minutes
} as const;

/** Ticker validation: 1-20 alphanumeric chars, dots, hyphens, forward-slashes, colons. */
const TICKER_REGEX = /^[A-Z0-9.\-/:]{1,20}$/i;

/** Yahoo Finance search API endpoint. */
const YAHOO_SEARCH_URL = 'https://query2.finance.yahoo.com/v1/finance/search';

interface YahooQuoteResult {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchange: string;
  quoteType: string;
}

interface YahooSearchResponse {
  quotes: YahooQuoteResult[];
}

/**
 * Public API for market data. Wraps provider calls with Redis caching.
 *
 * - `getQuote(ticker)`:          5-min cache, key `market:quote:{TICKER}`
 * - `getHistoricalBars(ticker)`: 30-min cache, key `market:bars:{TICKER}:{days}`
 * - `searchTickers(query)`:      10-min cache, key `market:search:{query}`
 */
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    private readonly registry: MarketDataProviderRegistry,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  // ── Quote ───────────────────────────────────────────────────────────────

  async getQuote(ticker: string): Promise<MarketQuote> {
    const normalised = this.validateAndNormaliseTicker(ticker);
    const cacheKey = `market:quote:${normalised}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as MarketQuote;
    }

    const provider = this.registry.getDefaultProvider();
    const quote = await provider.getQuote(normalised);
    await this.redis.setex(cacheKey, CACHE_TTL.QUOTE, JSON.stringify(quote));

    return quote;
  }

  // ── Historical Bars ─────────────────────────────────────────────────────

  async getHistoricalBars(ticker: string, days: number): Promise<MarketBar[]> {
    const normalised = this.validateAndNormaliseTicker(ticker);
    const cacheKey = `market:bars:${normalised}:${days}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as MarketBar[];
    }

    const provider = this.registry.getDefaultProvider();
    const bars = await provider.getHistoricalBars(normalised, days);
    await this.redis.setex(cacheKey, CACHE_TTL.BARS, JSON.stringify(bars));

    return bars;
  }

  // ── Ticker Search ───────────────────────────────────────────────────────

  async searchTickers(query: string): Promise<TickerSearchResult[]> {
    const cacheKey = `market:search:${query}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as TickerSearchResult[];
    }

    const results = await this.callYahooSearch(query);
    await this.redis.setex(cacheKey, CACHE_TTL.SEARCH, JSON.stringify(results));

    return results;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private validateAndNormaliseTicker(ticker: string): string {
    const normalised = ticker.toUpperCase();
    if (!TICKER_REGEX.test(normalised)) {
      throw new BadRequestException(
        `Invalid ticker format: '${ticker}'. Must be 1-20 alphanumeric characters, dots, hyphens, slashes, or colons.`,
      );
    }
    return normalised;
  }

  private async callYahooSearch(query: string): Promise<TickerSearchResult[]> {
    const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 FinSentinel/1.0',
      },
    });

    if (!response.ok) {
      this.logger.warn(`Yahoo search failed: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as YahooSearchResponse;

    return (data.quotes ?? []).map((q) => ({
      symbol: q.symbol,
      name: q.shortname ?? q.longname ?? q.symbol,
      exchange: q.exchange,
      assetType: q.quoteType,
    }));
  }
}
