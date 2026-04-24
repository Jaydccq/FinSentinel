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

  /**
   * Search tickers via the registry's search-capable provider. Cache key is
   * normalised (trim + lowercase) so 'AAPL', 'aapl', and '  AAPL  ' all hit
   * the same entry. Empty input short-circuits to [] without touching Redis.
   *
   * The `v2:` prefix invalidates the legacy un-normalised cache without
   * colliding with it.
   */
  async searchTickers(query: string, limit = 10): Promise<TickerSearchResult[]> {
    const normalised = query.trim().toLowerCase();
    if (!normalised) return [];

    const cacheKey = `market:search:v2:${normalised}:${limit}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as TickerSearchResult[];
    }

    const provider = this.registry.getSearchProvider();
    // getSearchProvider() guarantees searchTickers is defined; the non-null
    // assertion silences TS narrowing across the dynamic dispatch.
    const results = await provider.searchTickers!(normalised, limit);
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
}
