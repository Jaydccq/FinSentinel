import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { polygonConfig } from '../config/polygon.config';
import { PolygonResearchProvider } from './providers/polygon-research.provider';
import { YahooResearchProvider } from './providers/yahoo-research.provider';
import { ResearchDataProviderRegistry } from './research-data-provider.registry';
import { CompanyResearchService } from './company-research.service';
import { EquityScreenerService } from './equity-screener.service';

/**
 * Research module — company research providers, services, and equity screener.
 */
@Module({
  imports: [CommonModule],
  providers: [
    // Build provider instances
    {
      provide: PolygonResearchProvider,
      useFactory: (config: ConfigType<typeof polygonConfig>) =>
        new PolygonResearchProvider({ apiKey: config.apiKey }),
      inject: [polygonConfig.KEY],
    },
    {
      provide: YahooResearchProvider,
      useClass: YahooResearchProvider,
    },
    // Aggregate all providers into a single DI token
    {
      provide: 'RESEARCH_PROVIDERS',
      useFactory: (
        polygon: PolygonResearchProvider,
        yahoo: YahooResearchProvider,
      ) => [polygon, yahoo],
      inject: [PolygonResearchProvider, YahooResearchProvider],
    },
    ResearchDataProviderRegistry,
    CompanyResearchService,
    EquityScreenerService,
  ],
  exports: [
    CompanyResearchService,
    EquityScreenerService,
    ResearchDataProviderRegistry,
  ],
})
export class ResearchModule {}
