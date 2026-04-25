import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type Redis from 'ioredis';
import type { ScreenerResult, ScreenerCriteria } from '@finsentinel/shared';
import { polygonConfig } from '../config/polygon.config';

/** Cache TTLs in seconds. */
const CACHE_TTL = {
  MOVERS: 900, // 15 minutes
  SCREEN: 900, // 15 minutes
} as const;

/** Polygon snapshot response shape. */
interface PolygonSnapshotTicker {
  ticker: string;
  todaysChangePerc: number;
  todaysChange: number;
  day: {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  };
  prevDay: {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  };
}

interface PolygonSnapshotResponse {
  tickers: PolygonSnapshotTicker[];
}

/** Polygon reference tickers response shape. */
interface PolygonTickerRef {
  ticker: string;
  name: string;
  primary_exchange: string;
  type: string;
  locale: string;
  market_cap?: number;
  currency_name: string;
  active: boolean;
}

interface PolygonTickersResponse {
  results: PolygonTickerRef[];
}

/**
 * Equity screening and market movers via Polygon.io.
 *
 * - `getMarketMovers(type)`: Polygon snapshots for gainers/losers/most_active, 15-min cache.
 * - `screenTickers(criteria)`: Polygon reference tickers with filters, 15-min cache.
 */
@Injectable()
export class EquityScreenerService {
  private readonly logger = new Logger(EquityScreenerService.name);
  private readonly apiKey: string;
  private static readonly BASE_URL = 'https://api.polygon.io';

  constructor(
    @Inject(polygonConfig.KEY)
    private config: ConfigType<typeof polygonConfig>,
    @Inject('REDIS') private readonly redis: Redis,
  ) {
    this.apiKey = this.config.apiKey;
  }

  // ── Market Movers ──────────────────────────────────────────────────────

  async getMarketMovers(type: 'gainers' | 'losers' | 'most_active'): Promise<ScreenerResult[]> {
    const cacheKey = `research:movers:${type}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as ScreenerResult[];
    }

    const url =
      `${EquityScreenerService.BASE_URL}/v2/snapshot/locale/us/markets/stocks/${type}` +
      `?apiKey=${this.apiKey}`;

    this.logger.debug(`Polygon request: ${url.replace(this.apiKey, '***')}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as PolygonSnapshotResponse;

    const results: ScreenerResult[] = (data.tickers ?? []).map((t) => ({
      ticker: t.ticker,
      name: t.ticker, // Snapshot API does not include full company names
      primaryExchange: 'US',
      type: 'CS',
      locale: 'us',
      marketCap: '0', // Not available in snapshot
      currencyName: 'usd',
      active: true,
    }));

    await this.redis.setex(cacheKey, CACHE_TTL.MOVERS, JSON.stringify(results));

    return results;
  }

  // ── Ticker Screening ───────────────────────────────────────────────────

  async screenTickers(criteria: ScreenerCriteria): Promise<ScreenerResult[]> {
    const cacheKey = `research:screen:${JSON.stringify(criteria)}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as ScreenerResult[];
    }

    const params = new URLSearchParams();
    params.set('apiKey', this.apiKey);
    params.set('market', 'stocks');
    params.set('active', 'true');
    params.set('limit', String(criteria.limit));
    params.set('order', criteria.order);
    params.set('sort', criteria.sortBy);

    if (criteria.exchange) {
      params.set('exchange', criteria.exchange);
    }
    if (criteria.search) {
      params.set('search', criteria.search);
    }

    const url = `${EquityScreenerService.BASE_URL}/v3/reference/tickers?${params}`;

    this.logger.debug(`Polygon request: ${url.replace(this.apiKey, '***')}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as PolygonTickersResponse;

    const results: ScreenerResult[] = (data.results ?? []).map((t) => ({
      ticker: t.ticker,
      name: t.name,
      primaryExchange: t.primary_exchange,
      type: t.type,
      locale: t.locale,
      marketCap: (t.market_cap ?? 0).toFixed(2),
      currencyName: t.currency_name,
      active: t.active,
    }));

    await this.redis.setex(cacheKey, CACHE_TTL.SCREEN, JSON.stringify(results));

    return results;
  }

  async screenStocks(
    sector?: string,
    exchange?: string,
    marketCapMin?: string,
    marketCapMax?: string,
    search?: string,
    limit: number = 20,
  ): Promise<ScreenerResult[]> {
    return this.screenTickers({
      sector,
      exchange,
      marketCapMin,
      marketCapMax,
      search,
      limit,
      sortBy: 'market_cap',
      order: 'desc',
    });
  }

  async searchStocks(query: string, limit: number = 10): Promise<ScreenerResult[]> {
    return this.screenTickers({
      search: query,
      limit,
      sortBy: 'market_cap',
      order: 'desc',
    });
  }
}
