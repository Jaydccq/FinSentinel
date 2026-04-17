import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';

vi.mock('@finsentinel/ai-runtime', () => ({
  defineZodTool: (definition: {
    description: string;
    inputSchema: unknown;
    execute: (...args: any[]) => unknown;
  }) => ({
    ...definition,
    parameters: definition.inputSchema,
  }),
}));

import { ToolRegistry } from '../tool-registry';
import { MarketDataService } from '../../market/market-data.service';
import { TechnicalIndicatorsService } from '../../market/technical-indicators.service';
import { NewsAnalysisService } from '../news-analysis.service';
import { TwitterToolsService } from '../twitter-tools.service';
import { CryptoToolsService } from '../crypto-tools.service';
import { WatchlistService } from '../../watchlist/watchlist.service';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  let mockMarketDataService: Partial<MarketDataService>;
  let mockTechnicalIndicatorsService: Partial<TechnicalIndicatorsService>;
  let mockNewsAnalysisService: Partial<NewsAnalysisService>;
  let mockTwitterToolsService: Partial<TwitterToolsService>;
  let mockCryptoToolsService: Partial<CryptoToolsService>;
  let mockWatchlistService: Partial<WatchlistService>;

  beforeEach(async () => {
    mockMarketDataService = {
      getQuote: vi.fn(),
      getHistoricalBars: vi.fn(),
      searchTickers: vi.fn(),
    };

    mockTechnicalIndicatorsService = {
      calculateRSI: vi.fn(),
      calculateMACD: vi.fn(),
      calculateBollingerBands: vi.fn(),
      calculateEMA: vi.fn(),
      calculateSMA: vi.fn(),
      calculateATR: vi.fn(),
      calculateStochastic: vi.fn(),
      calculateADX: vi.fn(),
      calculateOBV: vi.fn(),
    };

    mockNewsAnalysisService = {
      getRecentNews: vi.fn(),
      searchKnowledgeBase: vi.fn(),
    };

    mockTwitterToolsService = {
      getTwitterProfile: vi.fn(),
      searchTweets: vi.fn(),
      getUserTweets: vi.fn(),
      getKolFollowers: vi.fn(),
    };

    mockCryptoToolsService = {
      getCryptoNews: vi.fn(),
      getCryptoNewsBySignal: vi.fn(),
      getFundingRate: vi.fn(),
      analyzePosition: vi.fn(),
      setLeverage: vi.fn(),
    };

    mockWatchlistService = {
      saveWatchlistItems: vi.fn(),
      getWatchlist: vi.fn(),
      organizeWatchlistCategory: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ToolRegistry,
        { provide: MarketDataService, useValue: mockMarketDataService },
        { provide: TechnicalIndicatorsService, useValue: mockTechnicalIndicatorsService },
        { provide: NewsAnalysisService, useValue: mockNewsAnalysisService },
        { provide: TwitterToolsService, useValue: mockTwitterToolsService },
        { provide: CryptoToolsService, useValue: mockCryptoToolsService },
        { provide: WatchlistService, useValue: mockWatchlistService },
      ],
    }).compile();

    registry = module.get(ToolRegistry);
  });

  // ── buildTools ────────────────────────────────────────────────────────────

  describe('buildTools', () => {
    it('returns all stateless tool keys', () => {
      const tools = registry.buildTools('user-1');
      const keys = Object.keys(tools);

      // Market data tools (from createStockMarketTools)
      expect(keys).toContain('getStockQuote');
      expect(keys).toContain('getHistoricalPrices');

      // Technical indicator tools (from createTechnicalIndicatorTools)
      expect(keys).toContain('calculateRSI');
      expect(keys).toContain('calculateMACD');
      expect(keys).toContain('calculateBollingerBands');
      expect(keys).toContain('calculateEMA');
      expect(keys).toContain('calculateSMA');
      expect(keys).toContain('calculateATR');
      expect(keys).toContain('calculateStochastic');
      expect(keys).toContain('calculateADX');
      expect(keys).toContain('calculateOBV');

      // Thinking tools (from createThinkingTools — always included)
      expect(keys).toContain('analyzeMarket');
      expect(keys).toContain('planInvestmentAction');
      expect(keys).toContain('calculate');
      expect(keys).toContain('reportWarning');

      // Confirmation tool (from createConfirmationTools — always included)
      expect(keys).toContain('getConfirm');

      // News + RAG
      expect(keys).toContain('getRecentNews');
      expect(keys).toContain('searchKnowledgeBase');

      // Twitter / crypto-social
      expect(keys).toContain('getTwitterProfile');
      expect(keys).toContain('searchTweets');
      expect(keys).toContain('getCryptoNews');

      // OKX crypto analytics
      expect(keys).toContain('getFundingRate');
      expect(keys).toContain('analyzePosition');
      expect(keys).toContain('setLeverage');

      // Watchlist persistence
      expect(keys).toContain('saveWatchlistItems');
      expect(keys).toContain('getWatchlist');
      expect(keys).toContain('organizeWatchlistCategory');
    });

    it('tools have correct structure (description, inputSchema, execute)', () => {
      const tools = registry.buildTools('user-1');

      for (const [name, t] of Object.entries(tools)) {
        const toolObj = t as Record<string, unknown>;
        expect(toolObj, `${name} missing description`).toHaveProperty('description');
        expect(typeof toolObj.description, `${name} description not string`).toBe('string');
        expect((toolObj.description as string).length, `${name} description empty`).toBeGreaterThan(0);
        expect(toolObj, `${name} missing inputSchema`).toHaveProperty('inputSchema');
        expect(toolObj, `${name} missing parameters`).toHaveProperty('parameters');
        expect(toolObj, `${name} missing execute`).toHaveProperty('execute');
        expect(typeof toolObj.execute, `${name} execute not function`).toBe('function');
      }
    });

    it('passes userId to tools via closure', () => {
      const tools1 = registry.buildTools('user-1');
      const tools2 = registry.buildTools('user-2');

      // Each call should produce a fresh tools object (different references)
      expect(tools1).not.toBe(tools2);
    });
  });

  // ── buildStockAnalysisTools ───────────────────────────────────────────────

  describe('buildStockAnalysisTools', () => {
    it('returns exactly the stock analysis tool subset', () => {
      const tools = registry.buildStockAnalysisTools();
      const keys = Object.keys(tools);

      // Must include market data + technical indicators
      expect(keys).toContain('getStockQuote');
      expect(keys).toContain('getHistoricalPrices');
      expect(keys).toContain('calculateRSI');
      expect(keys).toContain('calculateMACD');
      expect(keys).toContain('calculateBollingerBands');

      // Must NOT include user-scoped tools or thinking/confirmation tools
      expect(keys).not.toContain('analyzePortfolio');
      expect(keys).not.toContain('stageOrder');
      expect(keys).not.toContain('commitTrade');
      expect(keys).not.toContain('analyzeMarket');
      expect(keys).not.toContain('getConfirm');
    });

    it('tools have correct structure', () => {
      const tools = registry.buildStockAnalysisTools();

      for (const [name, t] of Object.entries(tools)) {
        const toolObj = t as Record<string, unknown>;
        expect(toolObj, `${name} missing description`).toHaveProperty('description');
        expect(typeof toolObj.description, `${name} description not string`).toBe('string');
        expect((toolObj.description as string).length, `${name} description empty`).toBeGreaterThan(0);
        expect(toolObj, `${name} missing inputSchema`).toHaveProperty('inputSchema');
        expect(toolObj, `${name} missing parameters`).toHaveProperty('parameters');
        expect(toolObj, `${name} missing execute`).toHaveProperty('execute');
        expect(typeof toolObj.execute, `${name} execute not function`).toBe('function');
      }
    });
  });

  // ── Tool execution ────────────────────────────────────────────────────────

  describe('tool execution', () => {
    it('getStockQuote delegates to MarketDataService.getQuote', async () => {
      const mockQuote = { ticker: 'AAPL', close: '150.00' };
      (mockMarketDataService.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(mockQuote);

      const tools = registry.buildTools('user-1');
      const result = await (tools['getStockQuote'] as any).execute({ ticker: 'AAPL' });

      expect(mockMarketDataService.getQuote).toHaveBeenCalledWith('AAPL');
      expect(result).toContain('AAPL');
    });

    it('calculateRSI delegates to TechnicalIndicatorsService', async () => {
      (mockTechnicalIndicatorsService.calculateRSI as ReturnType<typeof vi.fn>).mockReturnValue(
        'RSI(14) Analysis:\nCurrent RSI: 55.00',
      );

      const tools = registry.buildTools('user-1');
      const result = await (tools['calculateRSI'] as any).execute({
        barsJson: '[]',
        period: 14,
      });

      expect(mockTechnicalIndicatorsService.calculateRSI).toHaveBeenCalledWith('[]', 14);
      expect(result).toContain('RSI');
    });

    it('saveWatchlistItems delegates to WatchlistService', async () => {
      (mockWatchlistService.saveWatchlistItems as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'watchlist-category-1',
        name: '电',
        key: '电',
        description: '',
        summary: '',
        itemCount: 1,
        items: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const tools = registry.buildTools('user-1');
      await (tools['saveWatchlistItems'] as any).execute({
        categoryName: '电',
        items: [{ symbol: 'CEG' }],
      });

      expect(mockWatchlistService.saveWatchlistItems).toHaveBeenCalledWith('user-1', {
        categoryName: '电',
        items: [{ symbol: 'CEG' }],
      });
    });
  });
});
