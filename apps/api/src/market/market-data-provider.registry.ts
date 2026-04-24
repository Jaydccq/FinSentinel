import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { polygonConfig } from '../config/polygon.config';
import type { MarketDataProvider } from './interfaces/market-data-provider';

/**
 * Registry of all available market-data providers.
 *
 * Accepts a list of providers via DI token, indexes them by name,
 * and exposes O(1) lookups plus a configurable default.
 */
@Injectable()
export class MarketDataProviderRegistry {
  private readonly logger = new Logger(MarketDataProviderRegistry.name);
  private readonly providers = new Map<string, MarketDataProvider>();
  private readonly defaultProviderName: string;

  constructor(
    @Inject('MARKET_DATA_PROVIDERS') providers: MarketDataProvider[],
    @Inject(polygonConfig.KEY) private config: ConfigType<typeof polygonConfig>,
  ) {
    for (const p of providers) {
      this.providers.set(p.getName(), p);
      this.logger.log(`Registered market data provider: ${p.getName()}`);
    }

    // Default to 'polygon'; if not available fall back to first registered
    this.defaultProviderName = this.providers.has('polygon')
      ? 'polygon'
      : (providers[0]?.getName() ?? 'polygon');

    this.logger.log(`Default market data provider: ${this.defaultProviderName}`);
  }

  /** O(1) lookup by provider name. */
  getProvider(name: string): MarketDataProvider | undefined {
    return this.providers.get(name);
  }

  /** Returns the default provider (polygon, or first registered). */
  getDefaultProvider(): MarketDataProvider {
    const provider = this.providers.get(this.defaultProviderName);
    if (!provider) {
      throw new Error(
        `Default market data provider '${this.defaultProviderName}' not found. ` +
          `Available: ${this.getRegisteredProviderNames().join(', ')}`,
      );
    }
    return provider;
  }

  /** List all registered provider names. */
  getRegisteredProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Returns a provider that implements `searchTickers`. Prefers the default
   * provider (so future Polygon/Alpaca search opt-in flows through the same
   * registry path); falls back to the Yahoo provider, which always implements
   * search. Throws if neither is available.
   */
  getSearchProvider(): MarketDataProvider {
    const def = this.providers.get(this.defaultProviderName);
    if (def && typeof def.searchTickers === 'function') {
      return def;
    }
    const yahoo = this.providers.get('yahoo');
    if (yahoo && typeof yahoo.searchTickers === 'function') {
      return yahoo;
    }
    throw new Error(
      'No search-capable market-data provider registered. ' +
        `Default '${this.defaultProviderName}' lacks searchTickers and Yahoo is not available. ` +
        `Registered: ${this.getRegisteredProviderNames().join(', ')}`,
    );
  }
}
