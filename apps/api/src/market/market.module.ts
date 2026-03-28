import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { polygonConfig } from '../config/polygon.config';
import { PolygonMarketDataProvider } from './providers/polygon.provider';
import { MarketDataProviderRegistry } from './market-data-provider.registry';
import { MarketDataService } from './market-data.service';
import { TechnicalIndicatorsService } from './technical-indicators.service';

@Module({
  imports: [CommonModule],
  providers: [
    // Build providers list and inject as a single token
    {
      provide: PolygonMarketDataProvider,
      useFactory: (config: ConfigType<typeof polygonConfig>) =>
        new PolygonMarketDataProvider({ apiKey: config.apiKey }),
      inject: [polygonConfig.KEY],
    },
    {
      provide: 'MARKET_DATA_PROVIDERS',
      useFactory: (polygon: PolygonMarketDataProvider) => [polygon],
      inject: [PolygonMarketDataProvider],
    },
    MarketDataProviderRegistry,
    MarketDataService,
    TechnicalIndicatorsService,
  ],
  exports: [MarketDataService, MarketDataProviderRegistry, TechnicalIndicatorsService],
})
export class MarketModule {}
