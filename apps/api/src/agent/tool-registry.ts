import { Injectable, Optional } from '@nestjs/common';
import type { FinToolSet } from '@finsentinel/ai-runtime';
import { MarketDataService } from '../market/market-data.service';
import { TechnicalIndicatorsService } from '../market/technical-indicators.service';
import { StrategyTemplateService } from '../market/strategy-template.service';
import { MarketCalendarService } from '../market/market-calendar.service';
import { OwnershipDataService } from '../market/ownership-data.service';
import { CompanyResearchService } from '../research/company-research.service';
import { EquityScreenerService } from '../research/equity-screener.service';
import { UnifiedTradingService } from '../trading/unified-trading.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ScheduleService } from '../autonomy/schedule.service';
import { HeartbeatService } from '../autonomy/heartbeat.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import {
  createStockMarketTools,
  createTechnicalIndicatorTools,
  createStrategyTemplateTools,
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
  createWatchlistTools,
} from './tools';
import { AgentBrainService } from './agent-brain.service';
import { UserInvestmentProfileService } from './user-investment-profile.service';
import { NewsAnalysisService } from './news-analysis.service';
import { TwitterToolsService } from './twitter-tools.service';
import { CryptoToolsService } from './crypto-tools.service';

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
    @Optional()
    private readonly strategyTemplateService?: StrategyTemplateService,
    @Optional()
    private readonly companyResearchService?: CompanyResearchService,
    @Optional()
    private readonly equityScreenerService?: EquityScreenerService,
    @Optional()
    private readonly marketCalendarService?: MarketCalendarService,
    @Optional()
    private readonly ownershipDataService?: OwnershipDataService,
    @Optional()
    private readonly unifiedTradingService?: UnifiedTradingService,
    @Optional()
    private readonly agentBrainService?: AgentBrainService,
    @Optional()
    private readonly userInvestmentProfileService?: UserInvestmentProfileService,
    @Optional()
    private readonly portfolioService?: PortfolioService,
    @Optional()
    private readonly scheduleService?: ScheduleService,
    @Optional()
    private readonly heartbeatService?: HeartbeatService,
    @Optional()
    private readonly newsAnalysisService?: NewsAnalysisService,
    @Optional()
    private readonly twitterToolsService?: TwitterToolsService,
    @Optional()
    private readonly cryptoToolsService?: CryptoToolsService,
    @Optional()
    private readonly watchlistService?: WatchlistService,
  ) {}

  /**
   * Build the full tools object for the primary risk agent.
   * @param userId  The authenticated user's ID (injected into user-scoped tools via closure)
   * @param portfolioId  Optional portfolio ID for portfolio-scoped tools
   */
  buildTools(userId: string, portfolioId?: string): FinToolSet {
    return {
      // Group A — fully wired to existing services
      ...createStockMarketTools(this.marketDataService),
      ...createTechnicalIndicatorTools(this.technicalIndicatorsService),
      ...(this.strategyTemplateService
        ? createStrategyTemplateTools(this.strategyTemplateService)
        : {}),

      // Group B — no-service tools (always available)
      ...createThinkingTools(),
      ...createConfirmationTools({
        blockLiveMode: true,
        tradeAmountThreshold: 10000,
      }),

      ...(this.companyResearchService
        ? createCompanyResearchTools(this.companyResearchService)
        : {}),
      ...(this.newsAnalysisService
        ? createNewsAnalysisTools(this.newsAnalysisService)
        : {}),
      ...(this.equityScreenerService
        ? createEquityScreenerTools(this.equityScreenerService)
        : {}),
      ...(this.marketCalendarService
        ? createMarketCalendarTools(this.marketCalendarService)
        : {}),
      ...(this.ownershipDataService
        ? createOwnershipTools(this.ownershipDataService)
        : {}),

      ...(this.unifiedTradingService
        ? createUnifiedTradingTools(
            {
              stage: async (currentUserId, action, symbol, qty, amount, price) => {
                const count = await this.unifiedTradingService!.stage(currentUserId, {
                  action: action as 'BUY' | 'SELL' | 'CLOSE',
                  symbol,
                  qty,
                  amount,
                  price,
                });
                return `Staged ${action} ${symbol} (${count} operation(s) staged).`;
              },
              commit: async (currentUserId, message) => {
                const result = await this.unifiedTradingService!.commit(currentUserId, message);
                return `Committed ${result.count} operation(s) with hash ${result.hash}.`;
              },
              execute: async (currentUserId) =>
                (await this.unifiedTradingService!.execute(currentUserId)).report,
              getWalletStatus: async (currentUserId) =>
                this.unifiedTradingService!.getWalletStatus(currentUserId),
              getPositions: async (currentUserId) =>
                this.unifiedTradingService!.getPositions(currentUserId),
              getCommitLog: async (currentUserId, limit) =>
                this.unifiedTradingService!.getCommitLog(currentUserId, limit),
              getStagedOrders: async (currentUserId) =>
                this.unifiedTradingService!.getStagedOrders(currentUserId),
              searchAssets: async (currentUserId, query) =>
                JSON.stringify(
                  await this.unifiedTradingService!.searchAssets(currentUserId, query),
                  null,
                  2,
                ),
              checkMarketHours: async (currentUserId) =>
                this.unifiedTradingService!.checkMarketHours(currentUserId),
              syncOrders: async (currentUserId) =>
                this.unifiedTradingService!.syncOrders(currentUserId),
              switchMode: async (currentUserId, mode) => {
                await this.unifiedTradingService!.switchMode(currentUserId, mode as 'PAPER' | 'LIVE');
                return `Trading mode switched to ${mode}.`;
              },
            },
            userId,
          )
        : {}),
      ...(this.agentBrainService
        ? createBrainTools(this.agentBrainService, userId)
        : {}),
      ...(this.userInvestmentProfileService
        ? createUserProfileTools(this.userInvestmentProfileService, userId)
        : {}),
      ...(this.portfolioService
        ? createPortfolioAnalysisTools(this.portfolioService, userId)
        : {}),
      ...(this.watchlistService
        ? createWatchlistTools(this.watchlistService, userId)
        : {}),
      ...(this.scheduleService && this.heartbeatService
        ? createAutonomyTools(this.scheduleService, this.heartbeatService, userId)
        : {}),
      ...(this.cryptoToolsService
        ? createCryptoNewsTools(this.cryptoToolsService)
        : {}),
      ...(this.twitterToolsService
        ? createTwitterTools(this.twitterToolsService)
        : {}),
      ...(this.cryptoToolsService
        ? createCryptoAnalyticsTools(this.cryptoToolsService)
        : {}),
    };
  }

  /**
   * Build the lightweight tool subset for the secondary stock-analysis agent.
   * Only market data + technical indicators — no user-scoped tools.
   */
  buildStockAnalysisTools(): FinToolSet {
    return {
      ...createStockMarketTools(this.marketDataService),
      ...createTechnicalIndicatorTools(this.technicalIndicatorsService),
      ...(this.strategyTemplateService
        ? createStrategyTemplateTools(this.strategyTemplateService)
        : {}),
    };
  }
}
