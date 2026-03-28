import { Injectable } from '@nestjs/common';
import type { ToolSet } from 'ai';
import { MarketDataService } from '../market/market-data.service';
import { TechnicalIndicatorsService } from '../market/technical-indicators.service';
import {
  createStockMarketTools,
  createTechnicalIndicatorTools,
  createThinkingTools,
  createConfirmationTools,
  createNewsAnalysisTools,
  createQuantAnalysisTools,
  createCompanyResearchTools,
  createEquityScreenerTools,
  createMarketCalendarTools,
  createOwnershipTools,
  createShortInterestTools,
  createUnifiedTradingTools,
  createBrainTools,
  createUserProfileTools,
  createPortfolioAnalysisTools,
  createAutonomyTools,
  createCryptoNewsTools,
  createTwitterTools,
  createCryptoAnalyticsTools,
} from './tools';

/**
 * Builds the tools object per-request, injecting userId via closure for
 * user-scoped tools. Stateless tools (market data, technical indicators,
 * thinking, confirmation) are always included. User-scoped tools and
 * optional tools will be added incrementally as their backing services are built.
 */
@Injectable()
export class ToolRegistry {
  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly technicalIndicatorsService: TechnicalIndicatorsService,
  ) {}

  /**
   * Build the full tools object for the primary risk agent.
   * @param userId  The authenticated user's ID (injected into user-scoped tools via closure)
   * @param portfolioId  Optional portfolio ID for portfolio-scoped tools
   */
  buildTools(userId: string, portfolioId?: string): ToolSet {
    return {
      // Group A — fully wired to existing services
      ...createStockMarketTools(this.marketDataService),
      ...createTechnicalIndicatorTools(this.technicalIndicatorsService),

      // Group B — no-service tools (always available)
      ...createThinkingTools(),
      ...createConfirmationTools({
        blockLiveMode: true,
        tradeAmountThreshold: 10000,
      }),

      // TODO: add Group B service-backed tools when services exist
      // ...createNewsAnalysisTools(newsAnalysisService),
      // ...createQuantAnalysisTools(quantAnalysisService),
      // ...createCompanyResearchTools(companyResearchService),
      // ...createEquityScreenerTools(equityScreenerService),
      // ...createMarketCalendarTools(marketCalendarService),
      // ...createOwnershipTools(ownershipService),
      // ...createShortInterestTools(shortInterestService),

      // TODO: add Group C user-scoped tools when services exist
      // ...createUnifiedTradingTools(tradingService, userId),
      // ...createBrainTools(brainService, userId),
      // ...createUserProfileTools(profileService, userId),
      // ...createPortfolioAnalysisTools(portfolioService, userId),
      // ...createAutonomyTools(scheduleService, heartbeatService, userId),

      // TODO: add Group D optional tools when services exist + feature flags
      // ...createCryptoNewsTools(cryptoNewsService),
      // ...createTwitterTools(twitterService),
      // ...createCryptoAnalyticsTools(cryptoAnalyticsService),
    };
  }

  /**
   * Build the lightweight tool subset for the secondary stock-analysis agent.
   * Only market data + technical indicators — no user-scoped tools.
   */
  buildStockAnalysisTools(): ToolSet {
    return {
      ...createStockMarketTools(this.marketDataService),
      ...createTechnicalIndicatorTools(this.technicalIndicatorsService),
    };
  }
}
