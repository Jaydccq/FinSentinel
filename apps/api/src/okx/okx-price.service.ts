import { Injectable, Logger } from '@nestjs/common';
import type { OkxTicker } from './interfaces/okx-types';

/**
 * In-memory ticker price cache for OKX instruments.
 *
 * Provides fast last-price lookups from cached ticker data.
 * Tickers are updated by external sources (WebSocket feeds, polling, etc.).
 *
 * Mirrors the Java OkxPriceService exactly.
 */
@Injectable()
export class OkxPriceService {
  private readonly logger = new Logger(OkxPriceService.name);
  private readonly cache = new Map<string, OkxTicker>();

  /**
   * Update the cached ticker for an instrument.
   */
  updateTicker(instId: string, ticker: OkxTicker): void {
    this.cache.set(instId, ticker);
  }

  /**
   * Get the mid-price for an instrument (average of best bid and best ask).
   * Returns null if no ticker is cached for the given instId.
   */
  getPrice(instId: string): number | null {
    const ticker = this.cache.get(instId);
    if (!ticker) {
      return null;
    }

    const bid = Number(ticker.bidPx);
    const ask = Number(ticker.askPx);

    if (isNaN(bid) || isNaN(ask) || bid === 0 || ask === 0) {
      // Fall back to last traded price
      const last = Number(ticker.last);
      return isNaN(last) ? null : last;
    }

    return (bid + ask) / 2;
  }

  /**
   * Get all cached tickers as a snapshot.
   */
  getSnapshot(): Map<string, OkxTicker> {
    return new Map(this.cache);
  }

  /**
   * Get a single cached ticker by instrument ID.
   */
  getTicker(instId: string): OkxTicker | undefined {
    return this.cache.get(instId);
  }

  /**
   * Remove a ticker from the cache.
   */
  removeTicker(instId: string): void {
    this.cache.delete(instId);
  }

  /**
   * Clear all cached tickers.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Number of cached tickers.
   */
  get size(): number {
    return this.cache.size;
  }
}
