import type { RoleKey } from './role-contract';

/**
 * v1 tool allow-lists per role. Tool names must match keys in
 * apps/api/src/agent/tools/index.ts.
 */
export const ROLE_TOOL_SCOPE: Record<RoleKey, readonly string[]> = {
  MARKET_ANALYST: [
    'getStockQuote',
    'getHistoricalPrices',
    'calculateRSI',
    'calculateMACD',
    'calculateBollingerBands',
    'calculateSMA',
    'calculateEMA',
    'calculateATR',
    'calculateStochastic',
    'calculateADX',
    'calculateOBV',
    'checkMarketHours',
  ],
  NEWS_ANALYST: [
    'getRecentNews',
    'getCryptoNews',
    'getCryptoNewsBySignal',
    'searchKnowledgeBase',
    'getTwitterProfile',
    'searchTweets',
    'getUserTweets',
  ],
  FUNDAMENTALS_ANALYST: [
    'searchKnowledgeBase',
    'getUpcomingEarnings',
    'getDividendHistory',
    'getSplitHistory',
    'getInstitutionalHolders',
    'getInsiderTransactions',
    'getShortInterest',
    'getFailsToDeliver',
  ],
  SENTIMENT_ANALYST: [
    'getRecentNews',
    'searchTweets',
    'getKolFollowers',
    'searchKnowledgeBase',
  ],
  POSITIVE_CASE: [],
  NEGATIVE_CASE: [],
  THESIS_LEAD: [],
  RISK_REVIEWER: ['analyzePortfolio', 'searchKnowledgeBase'],
  PORTFOLIO_MANAGER: ['analyzePortfolio', 'getPositions', 'getWalletStatus'],
  TRADE_PLANNER: ['analyzePortfolio', 'getPositions', 'getStockQuote'],
  EXECUTION_DRAFT_BUILDER: ['getStockQuote', 'checkMarketHours'],
};
