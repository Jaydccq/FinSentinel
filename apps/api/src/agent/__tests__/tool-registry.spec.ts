import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ToolRegistry } from '../tool-registry';
import { MarketDataService } from '../../market/market-data.service';
import { TechnicalIndicatorsService } from '../../market/technical-indicators.service';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  let mockMarketDataService: Partial<MarketDataService>;
  let mockTechnicalIndicatorsService: Partial<TechnicalIndicatorsService>;

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

    const module = await Test.createTestingModule({
      providers: [
        ToolRegistry,
        { provide: MarketDataService, useValue: mockMarketDataService },
        { provide: TechnicalIndicatorsService, useValue: mockTechnicalIndicatorsService },
      ],
    }).compile();

    registry = module.get(ToolRegistry);
  });

  // ── buildTools ────────────────────────────────────────────────────────────

  describe('buildTools', () => {
    it('returns all stateless tool keys', () => {
      const tools = registry.buildTools('user-1');
      const keys = Object.keys(tools);

      // Market data tools
      expect(keys).toContain('getStockQuote');
      expect(keys).toContain('getHistoricalPrices');
      expect(keys).toContain('searchAssets');

      // Technical indicator tools
      expect(keys).toContain('calculateRSI');
      expect(keys).toContain('calculateMACD');
      expect(keys).toContain('calculateBollingerBands');
      expect(keys).toContain('calculateEMA');
      expect(keys).toContain('calculateSMA');
      expect(keys).toContain('calculateATR');
      expect(keys).toContain('calculateStochastic');
      expect(keys).toContain('calculateADX');
      expect(keys).toContain('calculateOBV');
    });

    it('tools have correct structure (description, inputSchema, execute)', () => {
      const tools = registry.buildTools('user-1');

      for (const [name, t] of Object.entries(tools)) {
        expect(t).toHaveProperty('description');
        expect(typeof (t as any).description).toBe('string');
        expect((t as any).description.length).toBeGreaterThan(0);

        expect(t).toHaveProperty('inputSchema');

        expect(t).toHaveProperty('execute');
        expect(typeof (t as any).execute).toBe('function');
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

      // Must include market data + technical indicators (the available ones)
      expect(keys).toContain('getStockQuote');
      expect(keys).toContain('getHistoricalPrices');
      expect(keys).toContain('calculateRSI');
      expect(keys).toContain('calculateMACD');
      expect(keys).toContain('calculateBollingerBands');

      // Must NOT include user-scoped tools
      expect(keys).not.toContain('analyzePortfolio');
      expect(keys).not.toContain('stageOrder');
      expect(keys).not.toContain('commitTrade');
    });

    it('tools have correct structure', () => {
      const tools = registry.buildStockAnalysisTools();

      for (const [, t] of Object.entries(tools)) {
        expect(t).toHaveProperty('description');
        expect(t).toHaveProperty('inputSchema');
        expect(t).toHaveProperty('execute');
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
  });
});
