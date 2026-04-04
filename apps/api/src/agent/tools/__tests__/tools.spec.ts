import { describe, it, expect, vi } from 'vitest';

import { createStockMarketTools } from '../stock-market.tool';
import { createTechnicalIndicatorTools } from '../technical-indicator.tool';
import { createThinkingTools } from '../thinking.tool';
import { createConfirmationTools } from '../confirmation.tool';
import { createNewsAnalysisTools } from '../news-analysis.tool';
import { createQuantAnalysisTools } from '../quant-analysis.tool';
import { createCompanyResearchTools } from '../company-research.tool';
import { createEquityScreenerTools } from '../equity-screener.tool';
import { createMarketCalendarTools } from '../market-calendar.tool';
import { createOwnershipTools } from '../ownership.tool';
import { createShortInterestTools } from '../short-interest.tool';
import { createUnifiedTradingTools } from '../unified-trading.tool';
import { createBrainTools } from '../brain.tool';
import { createUserProfileTools } from '../user-profile.tool';
import { createPortfolioAnalysisTools } from '../portfolio-analysis.tool';
import { createAutonomyTools } from '../autonomy.tool';
import { createCryptoNewsTools } from '../crypto-news.tool';
import { createTwitterTools } from '../twitter.tool';
import { createCryptoAnalyticsTools } from '../crypto-analytics.tool';

// ── Helper: assert all tools have correct AI SDK structure ──────────────────

function assertToolStructure(tools: Record<string, unknown>) {
  for (const [name, t] of Object.entries(tools)) {
    const toolObj = t as Record<string, unknown>;
    expect(toolObj, `${name} missing description`).toHaveProperty('description');
    expect(typeof toolObj.description, `${name} description not string`).toBe('string');
    expect((toolObj.description as string).length, `${name} description empty`).toBeGreaterThan(0);
    // AI SDK tool() with inputSchema produces 'inputSchema' on the output object
    expect(toolObj, `${name} missing inputSchema`).toHaveProperty('inputSchema');
    expect(toolObj, `${name} missing execute`).toHaveProperty('execute');
    expect(typeof toolObj.execute, `${name} execute not function`).toBe('function');
  }
}

// ── Group A: Fully wired tools ──────────────────────────────────────────────

describe('createStockMarketTools', () => {
  const mockService = {
    getQuote: vi.fn(),
    getHistoricalBars: vi.fn(),
    searchTickers: vi.fn(),
  } as any;

  it('returns correct tool keys', () => {
    const tools = createStockMarketTools(mockService);
    expect(Object.keys(tools)).toEqual(['getStockQuote', 'getHistoricalPrices']);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createStockMarketTools(mockService));
  });

  it('getStockQuote delegates to marketDataService.getQuote', async () => {
    const quote = { ticker: 'AAPL', close: 150.0 };
    mockService.getQuote.mockResolvedValue(quote);

    const tools = createStockMarketTools(mockService);
    const result = await (tools.getStockQuote as any).execute({ ticker: 'AAPL' });

    expect(mockService.getQuote).toHaveBeenCalledWith('AAPL');
    expect(result).toContain('AAPL');
  });

  it('getHistoricalPrices delegates to marketDataService.getHistoricalBars', async () => {
    const bars = [{ o: 150, h: 155, l: 149, c: 153, v: 1000, t: 1234567890 }];
    mockService.getHistoricalBars.mockResolvedValue(bars);

    const tools = createStockMarketTools(mockService);
    const result = await (tools.getHistoricalPrices as any).execute({
      ticker: 'MSFT',
      days: 30,
    });

    expect(mockService.getHistoricalBars).toHaveBeenCalledWith('MSFT', 30);
    expect(result).toContain('150');
  });

  it('returns error string on service failure, never throws', async () => {
    mockService.getQuote.mockRejectedValue(new Error('Network timeout'));

    const tools = createStockMarketTools(mockService);
    const result = await (tools.getStockQuote as any).execute({ ticker: 'FAIL' });

    expect(result).toContain('Error');
    expect(result).toContain('Network timeout');
  });
});

describe('createTechnicalIndicatorTools', () => {
  const mockService = {
    calculateRSI: vi.fn(),
    calculateMACD: vi.fn(),
    calculateBollingerBands: vi.fn(),
    calculateEMA: vi.fn(),
    calculateSMA: vi.fn(),
    calculateATR: vi.fn(),
    calculateStochastic: vi.fn(),
    calculateADX: vi.fn(),
    calculateOBV: vi.fn(),
  } as any;

  it('returns all 9 indicator tool keys', () => {
    const tools = createTechnicalIndicatorTools(mockService);
    const keys = Object.keys(tools);

    expect(keys).toEqual([
      'calculateRSI',
      'calculateMACD',
      'calculateBollingerBands',
      'calculateEMA',
      'calculateSMA',
      'calculateATR',
      'calculateStochastic',
      'calculateADX',
      'calculateOBV',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createTechnicalIndicatorTools(mockService));
  });

  it('calculateRSI delegates to service', async () => {
    mockService.calculateRSI.mockReturnValue('RSI(14) Analysis:\nCurrent RSI: 55.00');

    const tools = createTechnicalIndicatorTools(mockService);
    const result = await (tools.calculateRSI as any).execute({
      barsJson: '[]',
      period: 14,
    });

    expect(mockService.calculateRSI).toHaveBeenCalledWith('[]', 14);
    expect(result).toContain('RSI');
  });

  it('calculateMACD delegates to service with correct params', async () => {
    mockService.calculateMACD.mockReturnValue('MACD Analysis');

    const tools = createTechnicalIndicatorTools(mockService);
    await (tools.calculateMACD as any).execute({
      barsJson: '[]',
      shortPeriod: 12,
      longPeriod: 26,
      signalPeriod: 9,
    });

    expect(mockService.calculateMACD).toHaveBeenCalledWith('[]', 12, 26, 9);
  });

  it('returns error string on service failure, never throws', async () => {
    mockService.calculateOBV.mockImplementation(() => {
      throw new Error('Parse error');
    });

    const tools = createTechnicalIndicatorTools(mockService);
    const result = await (tools.calculateOBV as any).execute({ barsJson: 'invalid' });

    expect(result).toContain('Error');
    expect(result).toContain('Parse error');
  });
});

// ── Group B: Thinking (no service) ──────────────────────────────────────────

describe('createThinkingTools', () => {
  it('returns 4 thinking tool keys', () => {
    const tools = createThinkingTools();
    expect(Object.keys(tools)).toEqual([
      'analyzeMarket',
      'planInvestmentAction',
      'calculate',
      'reportWarning',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createThinkingTools());
  });

  it('analyzeMarket returns formatted string (no service call)', async () => {
    const tools = createThinkingTools();
    const result = await (tools.analyzeMarket as any).execute({
      observations: 'AAPL PE ratio is 28',
      analysis: 'Stock appears overvalued',
      keyFactors: 'valuation premium, momentum exhaustion',
    });

    expect(result).toContain('Analysis recorded');
    expect(result).toContain('valuation premium');
    expect(result).toContain('planInvestmentAction');
  });

  it('planInvestmentAction returns formatted plan', async () => {
    const tools = createThinkingTools();
    const result = await (tools.planInvestmentAction as any).execute({
      options: '1. Hold, 2. Sell 50%',
      decision: 'Sell 50% due to high valuation',
      steps: '1. Calculate sell qty, 2. Stage order',
    });

    expect(result).toContain('Investment plan recorded');
    expect(result).toContain('Sell 50%');
  });

  it('calculate evaluates arithmetic expressions safely', async () => {
    const tools = createThinkingTools();

    const r1 = await (tools.calculate as any).execute({ expression: '150.50 * 100' });
    expect(r1).toContain('15050');

    const r2 = await (tools.calculate as any).execute({
      expression: '(175 - 150) / 150 * 100',
    });
    expect(r2).toContain('16.6');
  });

  it('calculate handles division by zero', async () => {
    const tools = createThinkingTools();
    const result = await (tools.calculate as any).execute({ expression: '100 / 0' });
    expect(result).toContain('Error');
    expect(result).toContain('Division by zero');
  });

  it('calculate rejects invalid characters', async () => {
    const tools = createThinkingTools();
    const result = await (tools.calculate as any).execute({ expression: 'abc + 1' });
    expect(result).toContain('Error');
  });

  it('reportWarning returns formatted warning', async () => {
    const tools = createThinkingTools();
    const result = await (tools.reportWarning as any).execute({
      message: 'High concentration in tech',
      severity: 'HIGH',
      details: 'Tech sector is 65% of portfolio',
    });

    expect(result).toContain('WARNING [HIGH]');
    expect(result).toContain('High concentration');
  });
});

// ── Group B: Confirmation (config only) ─────────────────────────────────────

describe('createConfirmationTools', () => {
  it('returns correct tool key', () => {
    const tools = createConfirmationTools({
      blockLiveMode: true,
      tradeAmountThreshold: 10000,
    });
    expect(Object.keys(tools)).toEqual(['getConfirm']);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(
      createConfirmationTools({ blockLiveMode: true, tradeAmountThreshold: 10000 }),
    );
  });

  it('blocks LIVE mode when configured', async () => {
    const tools = createConfirmationTools({
      blockLiveMode: true,
      tradeAmountThreshold: 10000,
    });

    const result = await (tools.getConfirm as any).execute({
      action: 'Switch to LIVE trading mode',
    });

    expect(result).toContain('BLOCKED');
    expect(result).toContain('LIVE');
  });

  it('approves non-LIVE actions', async () => {
    const tools = createConfirmationTools({
      blockLiveMode: true,
      tradeAmountThreshold: 10000,
    });

    const result = await (tools.getConfirm as any).execute({
      action: 'Sell 100 shares of AAPL',
    });

    expect(result).toContain('APPROVED');
    expect(result).toContain('$10000');
  });

  it('allows LIVE when blockLiveMode is false', async () => {
    const tools = createConfirmationTools({
      blockLiveMode: false,
      tradeAmountThreshold: 50000,
    });

    const result = await (tools.getConfirm as any).execute({
      action: 'Enable live trading',
    });

    expect(result).toContain('APPROVED');
  });
});

// ── Group B: Service stub tools (verify keys + structure) ───────────────────

describe('createNewsAnalysisTools', () => {
  const stub = {
    getRecentNews: vi.fn().mockResolvedValue('News results'),
    searchKnowledgeBase: vi.fn().mockResolvedValue('KB results'),
  };

  it('returns correct tool keys', () => {
    expect(Object.keys(createNewsAnalysisTools(stub))).toEqual([
      'getRecentNews',
      'searchKnowledgeBase',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createNewsAnalysisTools(stub));
  });

  it('execute calls service and returns result', async () => {
    const tools = createNewsAnalysisTools(stub);
    const result = await (tools.getRecentNews as any).execute({
      ticker: 'AAPL',
      days: 7,
    });
    expect(stub.getRecentNews).toHaveBeenCalledWith('AAPL', 7);
    expect(result).toBe('News results');
  });
});

describe('createQuantAnalysisTools', () => {
  const stub = {
    analyzeReturns: vi.fn().mockResolvedValue('Return stats'),
    calculateVaR: vi.fn().mockResolvedValue('VaR results'),
    analyzeVolatility: vi.fn().mockResolvedValue('Vol analysis'),
    calculateCorrelation: vi.fn().mockResolvedValue('Correlation'),
  };

  it('returns 3 tool keys', () => {
    expect(Object.keys(createQuantAnalysisTools(stub))).toEqual([
      'analyzeReturns',
      'calculateVaR',
      'analyzeVolatility',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createQuantAnalysisTools(stub));
  });
});

describe('createCompanyResearchTools', () => {
  const stub = {
    getCompanyProfile: vi.fn().mockResolvedValue('Profile'),
    getFinancialStatements: vi.fn().mockResolvedValue('Financials'),
    getAnalystRating: vi.fn().mockResolvedValue('Rating'),
  };

  it('returns 3 tool keys', () => {
    expect(Object.keys(createCompanyResearchTools(stub))).toEqual([
      'getCompanyProfile',
      'getFinancialStatements',
      'getAnalystRating',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createCompanyResearchTools(stub));
  });
});

describe('createEquityScreenerTools', () => {
  const stub = {
    screenStocks: vi.fn().mockResolvedValue('Screen results'),
    getMarketMovers: vi.fn().mockResolvedValue('Movers'),
    searchStocks: vi.fn().mockResolvedValue('Search results'),
  };

  it('returns 3 tool keys', () => {
    expect(Object.keys(createEquityScreenerTools(stub))).toEqual([
      'screenStocks',
      'getMarketMovers',
      'searchStocks',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createEquityScreenerTools(stub));
  });
});

describe('createMarketCalendarTools', () => {
  const stub = {
    getUpcomingEarnings: vi.fn().mockResolvedValue('Earnings'),
    getDividendHistory: vi.fn().mockResolvedValue('Dividends'),
    getSplitHistory: vi.fn().mockResolvedValue('Splits'),
    getIPOCalendar: vi.fn().mockResolvedValue('IPOs'),
  };

  it('returns 4 tool keys', () => {
    expect(Object.keys(createMarketCalendarTools(stub))).toEqual([
      'getUpcomingEarnings',
      'getDividendHistory',
      'getSplitHistory',
      'getIPOCalendar',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createMarketCalendarTools(stub));
  });
});

describe('createOwnershipTools', () => {
  const stub = {
    getInstitutionalHolders: vi.fn().mockResolvedValue('Holders'),
    getInsiderTransactions: vi.fn().mockResolvedValue('Transactions'),
  };

  it('returns 2 tool keys', () => {
    expect(Object.keys(createOwnershipTools(stub))).toEqual([
      'getInstitutionalHolders',
      'getInsiderTransactions',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createOwnershipTools(stub));
  });
});

describe('createShortInterestTools', () => {
  const stub = {
    getShortInterest: vi.fn().mockResolvedValue('Short data'),
    getFailsToDeliver: vi.fn().mockResolvedValue('FTD data'),
  };

  it('returns 2 tool keys', () => {
    expect(Object.keys(createShortInterestTools(stub))).toEqual([
      'getShortInterest',
      'getFailsToDeliver',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createShortInterestTools(stub));
  });
});

// ── Group C: User-scoped tools ──────────────────────────────────────────────

describe('createUnifiedTradingTools', () => {
  const stub = {
    stage: vi.fn().mockResolvedValue('Staged'),
    commit: vi.fn().mockResolvedValue('Committed'),
    execute: vi.fn().mockResolvedValue('Executed'),
    getWalletStatus: vi.fn().mockResolvedValue('Wallet'),
    getPositions: vi.fn().mockResolvedValue('Positions'),
    getCommitLog: vi.fn().mockResolvedValue('History'),
    getStagedOrders: vi.fn().mockResolvedValue('Staged orders'),
    searchAssets: vi.fn().mockResolvedValue('Assets'),
    checkMarketHours: vi.fn().mockResolvedValue('Open'),
    syncOrders: vi.fn().mockResolvedValue('Synced'),
    switchMode: vi.fn().mockResolvedValue('Switched'),
  };

  it('returns 11 tool keys', () => {
    const tools = createUnifiedTradingTools(stub, 'user-1');
    expect(Object.keys(tools)).toHaveLength(11);
    expect(Object.keys(tools)).toContain('stageOrder');
    expect(Object.keys(tools)).toContain('commitTrade');
    expect(Object.keys(tools)).toContain('executeTrade');
    expect(Object.keys(tools)).toContain('getWalletStatus');
    expect(Object.keys(tools)).toContain('getPositions');
    expect(Object.keys(tools)).toContain('getTradeHistory');
    expect(Object.keys(tools)).toContain('getStagedOrders');
    expect(Object.keys(tools)).toContain('searchTradableAssets');
    expect(Object.keys(tools)).toContain('checkMarketHours');
    expect(Object.keys(tools)).toContain('syncOrders');
    expect(Object.keys(tools)).toContain('switchTradingMode');
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createUnifiedTradingTools(stub, 'user-1'));
  });

  it('injects userId via closure, not as tool parameter', async () => {
    const tools = createUnifiedTradingTools(stub, 'user-42');
    await (tools.getWalletStatus as any).execute({});
    expect(stub.getWalletStatus).toHaveBeenCalledWith('user-42');
  });
});

describe('createBrainTools', () => {
  const stub = {
    getFrontalLobe: vi.fn().mockResolvedValue('Strategy'),
    updateFrontalLobe: vi.fn().mockResolvedValue('Updated'),
    updateEmotion: vi.fn().mockResolvedValue('Emotion set'),
    getEmotion: vi.fn().mockResolvedValue('neutral'),
    getBrainLog: vi.fn().mockResolvedValue('Log'),
  };

  it('returns 5 tool keys', () => {
    const tools = createBrainTools(stub, 'user-1');
    expect(Object.keys(tools)).toEqual([
      'readStrategy',
      'updateStrategy',
      'reportEmotion',
      'checkEmotion',
      'getBrainLog',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createBrainTools(stub, 'user-1'));
  });

  it('injects userId via closure', async () => {
    const tools = createBrainTools(stub, 'user-99');
    await (tools.readStrategy as any).execute({});
    expect(stub.getFrontalLobe).toHaveBeenCalledWith('user-99');
  });
});

describe('createUserProfileTools', () => {
  const stub = {
    getProfileSummary: vi.fn().mockResolvedValue('Profile'),
    updateSentiment: vi.fn().mockResolvedValue('Updated'),
    updateWorkingMemory: vi.fn().mockResolvedValue('Saved'),
    updatePreferences: vi.fn().mockResolvedValue('Prefs updated'),
  };

  it('returns 4 tool keys', () => {
    expect(Object.keys(createUserProfileTools(stub, 'user-1'))).toEqual([
      'getUserInvestmentProfile',
      'updateUserSentiment',
      'updateWorkingMemory',
      'updateUserPreferences',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createUserProfileTools(stub, 'user-1'));
  });
});

describe('createPortfolioAnalysisTools', () => {
  const stub = {
    analyzePortfolio: vi.fn().mockResolvedValue('Analysis'),
  };

  it('returns 1 tool key', () => {
    expect(Object.keys(createPortfolioAnalysisTools(stub, 'user-1'))).toEqual([
      'analyzePortfolio',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createPortfolioAnalysisTools(stub, 'user-1'));
  });
});

describe('createAutonomyTools', () => {
  const scheduleStub = {
    createCronTask: vi.fn().mockResolvedValue('Created'),
    listCronTasks: vi.fn().mockResolvedValue('Tasks'),
    pauseCronTask: vi.fn().mockResolvedValue('Paused'),
    resumeCronTask: vi.fn().mockResolvedValue('Resumed'),
    deleteCronTask: vi.fn().mockResolvedValue('Deleted'),
  };
  const heartbeatStub = {
    configureHeartbeat: vi.fn().mockResolvedValue('Configured'),
    getHeartbeatConfig: vi.fn().mockResolvedValue('Config'),
  };

  it('returns 7 tool keys', () => {
    const tools = createAutonomyTools(scheduleStub, heartbeatStub, 'user-1');
    expect(Object.keys(tools)).toEqual([
      'createCronTask',
      'listCronTasks',
      'pauseCronTask',
      'resumeCronTask',
      'deleteCronTask',
      'configureHeartbeat',
      'getHeartbeatConfig',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(
      createAutonomyTools(scheduleStub, heartbeatStub, 'user-1'),
    );
  });
});

// ── Group D: Optional/conditional tools ─────────────────────────────────────

describe('createCryptoNewsTools', () => {
  const stub = {
    getCryptoNews: vi.fn().mockResolvedValue('Crypto news'),
    getCryptoNewsBySignal: vi.fn().mockResolvedValue('Signal news'),
  };

  it('returns 2 tool keys', () => {
    expect(Object.keys(createCryptoNewsTools(stub))).toEqual([
      'getCryptoNews',
      'getCryptoNewsBySignal',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createCryptoNewsTools(stub));
  });
});

describe('createTwitterTools', () => {
  const stub = {
    getTwitterProfile: vi.fn().mockResolvedValue('Profile'),
    searchTweets: vi.fn().mockResolvedValue('Tweets'),
    getUserTweets: vi.fn().mockResolvedValue('User tweets'),
    getKolFollowers: vi.fn().mockResolvedValue('KOL followers'),
  };

  it('returns 4 tool keys', () => {
    expect(Object.keys(createTwitterTools(stub))).toEqual([
      'getTwitterProfile',
      'searchTweets',
      'getUserTweets',
      'getKolFollowers',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createTwitterTools(stub));
  });

  it('strips @ prefix from username', async () => {
    const tools = createTwitterTools(stub);
    await (tools.getTwitterProfile as any).execute({ username: '@elonmusk' });
    expect(stub.getTwitterProfile).toHaveBeenCalledWith('elonmusk');
  });
});

describe('createCryptoAnalyticsTools', () => {
  const stub = {
    getFundingRate: vi.fn().mockResolvedValue('Funding rate'),
    analyzePosition: vi.fn().mockResolvedValue('Position analysis'),
    setLeverage: vi.fn().mockResolvedValue('Leverage set'),
  };

  it('returns 3 tool keys', () => {
    expect(Object.keys(createCryptoAnalyticsTools(stub))).toEqual([
      'getFundingRate',
      'analyzePosition',
      'setLeverage',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createCryptoAnalyticsTools(stub));
  });

  it('uppercases instrument ID', async () => {
    const tools = createCryptoAnalyticsTools(stub);
    await (tools.getFundingRate as any).execute({ instId: 'btc-usdt-swap' });
    expect(stub.getFundingRate).toHaveBeenCalledWith('BTC-USDT-SWAP');
  });
});

// ── Error handling contract: execute never throws ───────────────────────────

describe('error handling contract', () => {
  it('all tool factories return error strings instead of throwing', async () => {
    const failingStub = new Proxy(
      {},
      {
        get: () => vi.fn().mockRejectedValue(new Error('Service unavailable')),
      },
    ) as any;

    // Test a representative tool from each group
    const stockTools = createStockMarketTools(failingStub);
    const r1 = await (stockTools.getStockQuote as any).execute({ ticker: 'X' });
    expect(r1).toContain('Error');
    expect(typeof r1).toBe('string');

    const newsTools = createNewsAnalysisTools(failingStub);
    const r2 = await (newsTools.getRecentNews as any).execute({
      ticker: 'X',
      days: 1,
    });
    expect(r2).toContain('Error');
    expect(typeof r2).toBe('string');

    const tradingTools = createUnifiedTradingTools(failingStub, 'user-1');
    const r3 = await (tradingTools.getWalletStatus as any).execute({});
    expect(r3).toContain('Error');
    expect(typeof r3).toBe('string');

    const cryptoTools = createCryptoAnalyticsTools(failingStub);
    const r4 = await (cryptoTools.getFundingRate as any).execute({
      instId: 'BTC-USDT-SWAP',
    });
    expect(r4).toContain('Error');
    expect(typeof r4).toBe('string');
  });
});

// ── Tool count verification ─────────────────────────────────────────────────

describe('total tool count across all factories', () => {
  it('produces 65+ total tools', () => {
    const allStub = new Proxy(
      {},
      { get: () => vi.fn().mockResolvedValue('ok') },
    ) as any;

    const allTools = {
      ...createStockMarketTools(allStub),                          // 2
      ...createTechnicalIndicatorTools(allStub),                   // 9
      ...createNewsAnalysisTools(allStub),                         // 2
      ...createQuantAnalysisTools(allStub),                        // 3
      ...createCompanyResearchTools(allStub),                      // 3
      ...createEquityScreenerTools(allStub),                       // 3
      ...createMarketCalendarTools(allStub),                       // 4
      ...createOwnershipTools(allStub),                            // 2
      ...createShortInterestTools(allStub),                        // 2
      ...createThinkingTools(),                                    // 4
      ...createConfirmationTools({                                 // 1
        blockLiveMode: true,
        tradeAmountThreshold: 10000,
      }),
      ...createUnifiedTradingTools(allStub, 'u'),                  // 11
      ...createBrainTools(allStub, 'u'),                           // 5
      ...createUserProfileTools(allStub, 'u'),                     // 4
      ...createPortfolioAnalysisTools(allStub, 'u'),               // 1
      ...createAutonomyTools(allStub, allStub, 'u'),               // 7
      ...createCryptoNewsTools(allStub),                           // 2
      ...createTwitterTools(allStub),                              // 4
      ...createCryptoAnalyticsTools(allStub),                      // 3
    };

    const totalCount = Object.keys(allTools).length;
    expect(totalCount).toBeGreaterThanOrEqual(65);
  });
});
