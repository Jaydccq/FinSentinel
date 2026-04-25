import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { OpenbbModule } from '../openbb/openbb.module';
import { polygonConfig } from '../config/polygon.config';
import { fmpConfig } from '../config/fmp.config';
import { marketProviderConfig } from '../config/market-provider.config';
import { PolygonMarketDataProvider } from './providers/polygon.provider';
import { FmpMarketDataProvider } from './providers/fmp.provider';
import { YahooFinanceMarketDataProvider } from './providers/yahoo.provider';
import { MarketDataProviderRegistry } from './market-data-provider.registry';
import { MarketDataService } from './market-data.service';
import { TechnicalIndicatorsService } from './technical-indicators.service';
import { StrategyTemplateService } from './strategy-template.service';
import { MarketCalendarService } from './market-calendar.service';
import { OwnershipDataService } from './ownership-data.service';
import { MarketDataController } from './market-data.controller';
import type { MarketDataProvider } from './interfaces/market-data-provider';

function isMarketDataProvider(provider: MarketDataProvider | null): provider is MarketDataProvider {
  return provider !== null;
}

/**
 * Market module — Phase 3 data providers + Phase 12 controller.
 *
 * Providers registered conditionally based on config:
 * - Polygon: always (requires POLYGON_API_KEY)
 * - FMP: when FMP_ENABLED=true (requires FMP_API_KEY)
 * - Yahoo Finance: when YAHOO_FINANCE_ENABLED !== 'false' (no key needed)
 *
 * Calendar + Ownership services delegate to OpenBB.
 */
@Module({
  imports: [CommonModule, AuthModule, OpenbbModule],
  controllers: [MarketDataController],
  providers: [
    // ── Polygon (always registered) ──────────────────────────────────────
    {
      provide: PolygonMarketDataProvider,
      useFactory: (config: ConfigType<typeof polygonConfig>) =>
        new PolygonMarketDataProvider({ apiKey: config.apiKey }),
      inject: [polygonConfig.KEY],
    },

    // ── FMP (conditional) ────────────────────────────────────────────────
    {
      provide: FmpMarketDataProvider,
      useFactory: (config: ConfigType<typeof fmpConfig>) => {
        if (!config.enabled || !config.apiKey) return null;
        return new FmpMarketDataProvider({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
        });
      },
      inject: [fmpConfig.KEY],
    },

    // ── Yahoo Finance (conditional, enabled by default) ──────────────────
    {
      provide: YahooFinanceMarketDataProvider,
      useFactory: (config: ConfigType<typeof marketProviderConfig>) => {
        if (!config.yahooFinance.enabled) return null;
        return new YahooFinanceMarketDataProvider({
          baseUrl: config.yahooFinance.baseUrl,
        });
      },
      inject: [marketProviderConfig.KEY],
    },

    // ── Aggregate provider list ──────────────────────────────────────────
    {
      provide: 'MARKET_DATA_PROVIDERS',
      useFactory: (
        polygon: PolygonMarketDataProvider,
        fmp: FmpMarketDataProvider | null,
        yahoo: YahooFinanceMarketDataProvider | null,
      ): MarketDataProvider[] => {
        const providers = [polygon, fmp, yahoo].filter(
          (
            provider,
          ): provider is
            | PolygonMarketDataProvider
            | FmpMarketDataProvider
            | YahooFinanceMarketDataProvider => provider !== null,
        );
        return providers;
      },
      inject: [PolygonMarketDataProvider, FmpMarketDataProvider, YahooFinanceMarketDataProvider],
    },

    MarketDataProviderRegistry,
    MarketDataService,
    TechnicalIndicatorsService,
    StrategyTemplateService,

    // ── OpenBB-backed services ───────────────────────────────────────────
    MarketCalendarService,
    OwnershipDataService,
  ],
  exports: [
    MarketDataService,
    MarketDataProviderRegistry,
    TechnicalIndicatorsService,
    StrategyTemplateService,
    MarketCalendarService,
    OwnershipDataService,
  ],
})
export class MarketModule {}
