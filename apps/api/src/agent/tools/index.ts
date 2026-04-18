/**
 * Barrel export for all tool factory functions.
 *
 * Each factory accepts service dependencies and returns a record of AI SDK tool() definitions.
 *
 * Groups:
 *   A: Fully wired to existing services (stock-market, technical-indicator)
 *   B: Service stubs (news-analysis, quant-analysis, company-research, equity-screener,
 *      market-calendar, ownership, short-interest, thinking, confirmation)
 *   C: User-scoped (unified-trading, brain, user-profile, portfolio-analysis, autonomy)
 *   D: Optional/conditional (crypto-news, twitter, crypto-analytics)
 */

// Group A — fully wired
export { createStockMarketTools } from './stock-market.tool';
export { createTechnicalIndicatorTools } from './technical-indicator.tool';
export { createStrategyTemplateTools } from './strategy-template.tool';

// Group B — service stubs + no-service tools
export { createNewsAnalysisTools } from './news-analysis.tool';
export { createQuantAnalysisTools } from './quant-analysis.tool';
export { createCompanyResearchTools } from './company-research.tool';
export { createEquityScreenerTools } from './equity-screener.tool';
export { createMarketCalendarTools } from './market-calendar.tool';
export { createOwnershipTools } from './ownership.tool';
export { createShortInterestTools } from './short-interest.tool';
export { createThinkingTools } from './thinking.tool';
export { createConfirmationTools } from './confirmation.tool';
export type { ConfirmationConfig } from './confirmation.tool';

// Group C — user-scoped
export { createUnifiedTradingTools } from './unified-trading.tool';
export { createBrainTools } from './brain.tool';
export { createUserProfileTools } from './user-profile.tool';
export { createPortfolioAnalysisTools } from './portfolio-analysis.tool';
export { createAutonomyTools } from './autonomy.tool';
export { createWatchlistTools } from './watchlist.tool';

// Group D — optional/conditional
export { createCryptoNewsTools } from './crypto-news.tool';
export { createTwitterTools } from './twitter.tool';
export { createCryptoAnalyticsTools } from './crypto-analytics.tool';
