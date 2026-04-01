import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type {
  CompanyProfile,
  FinancialMetrics,
  AnalystConsensus,
} from '@finsentinel/shared';
import { CompanyResearchService } from '../company-research.service';
import { ResearchDataProviderRegistry } from '../research-data-provider.registry';
import type { ResearchDataProvider } from '../interfaces/research-data-provider';

// ── Mock Redis ──────────────────────────────────────────────────────────────
function createMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  };
}

// ── Mock Provider ───────────────────────────────────────────────────────────
function createMockProvider(): ResearchDataProvider {
  return {
    getName: vi.fn().mockReturnValue('mock'),
    getCompanyProfile: vi.fn(),
    getFinancialMetrics: vi.fn(),
    getAnalystConsensus: vi.fn(),
  };
}

describe('CompanyResearchService', () => {
  let service: CompanyResearchService;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockProvider: ResearchDataProvider;
  let mockRegistry: {
    getDefaultProvider: ReturnType<typeof vi.fn>;
    getProvider: ReturnType<typeof vi.fn>;
  };

  const sampleProfile: CompanyProfile = {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    description: 'Apple designs consumer electronics.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    homepageUrl: 'https://apple.com',
    marketCap: '2800000000000.00',
    employeeCount: 164000,
    listDate: '1980-12-12',
    exchange: 'XNAS',
  };

  const sampleMetrics: FinancialMetrics[] = [
    {
      ticker: 'AAPL',
      period: '2024',
      fiscalPeriod: 'Q3',
      revenue: '94000000000.00',
      netIncome: '23600000000.00',
      eps: '1.53',
      grossMargin: '0.4574',
      operatingMargin: '0.2979',
      netMargin: '0.2511',
      totalAssets: '350000000000.00',
      totalLiabilities: '280000000000.00',
      totalEquity: '70000000000.00',
      currentRatio: '0.9333',
      debtToEquity: '4.0000',
      peRatio: '0.00',
      pbRatio: '0.00',
      revenueGrowth: '0.00',
      operatingCashFlow: '29000000000.00',
      freeCashFlow: '19000000000.00',
      capitalExpenditure: '-10000000000.00',
    },
  ];

  const sampleConsensus: AnalystConsensus = {
    ticker: 'AAPL',
    recommendation: 'buy',
    targetPriceHigh: '250.00',
    targetPriceLow: '180.00',
    targetPriceMedian: '220.00',
    currentPrice: '195.00',
    upsidePotential: '12.82',
    computationNote: 'Data sourced from Yahoo Finance analyst estimates.',
  };

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockProvider = createMockProvider();
    mockRegistry = {
      getDefaultProvider: vi.fn().mockReturnValue(mockProvider),
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    const module = await Test.createTestingModule({
      providers: [
        CompanyResearchService,
        {
          provide: ResearchDataProviderRegistry,
          useValue: mockRegistry,
        },
        {
          provide: 'REDIS',
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get(CompanyResearchService);
  });

  // ── getCompanyProfile ──────────────────────────────────────────────────

  describe('getCompanyProfile', () => {
    it('returns data from provider on cache miss with 4-hour TTL', async () => {
      mockRedis.get.mockResolvedValue(null);
      (
        mockProvider.getCompanyProfile as ReturnType<typeof vi.fn>
      ).mockResolvedValue(sampleProfile);

      const result = await service.getCompanyProfile('AAPL');

      expect(result).toEqual(sampleProfile);
      expect(mockRedis.get).toHaveBeenCalledWith(
        'research:profile:AAPL:mock',
      );
      expect(mockProvider.getCompanyProfile).toHaveBeenCalledWith('AAPL');
      // 4-hour TTL = 14400 seconds
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'research:profile:AAPL:mock',
        14400,
        JSON.stringify(sampleProfile),
      );
    });

    it('returns cached data on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sampleProfile));

      const result = await service.getCompanyProfile('AAPL');

      expect(result).toEqual(sampleProfile);
      expect(mockProvider.getCompanyProfile).not.toHaveBeenCalled();
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('uppercases ticker in cache key', async () => {
      mockRedis.get.mockResolvedValue(null);
      (
        mockProvider.getCompanyProfile as ReturnType<typeof vi.fn>
      ).mockResolvedValue(sampleProfile);

      await service.getCompanyProfile('aapl');

      expect(mockRedis.get).toHaveBeenCalledWith(
        'research:profile:AAPL:mock',
      );
      expect(mockProvider.getCompanyProfile).toHaveBeenCalledWith('AAPL');
    });

    it('uses named provider when specified', async () => {
      mockRedis.get.mockResolvedValue(null);
      (
        mockProvider.getCompanyProfile as ReturnType<typeof vi.fn>
      ).mockResolvedValue(sampleProfile);

      await service.getCompanyProfile('AAPL', 'mock');

      expect(mockRegistry.getProvider).toHaveBeenCalledWith('mock');
      expect(mockRegistry.getDefaultProvider).not.toHaveBeenCalled();
    });

    it('throws when named provider not found', async () => {
      mockRegistry.getProvider.mockReturnValue(undefined);

      await expect(
        service.getCompanyProfile('AAPL', 'nonexistent'),
      ).rejects.toThrow(/Research provider 'nonexistent' not found/);
    });
  });

  // ── getFinancialMetrics ────────────────────────────────────────────────

  describe('getFinancialMetrics', () => {
    it('returns data from provider on cache miss with 4-hour TTL', async () => {
      mockRedis.get.mockResolvedValue(null);
      (
        mockProvider.getFinancialMetrics as ReturnType<typeof vi.fn>
      ).mockResolvedValue(sampleMetrics);

      const result = await service.getFinancialMetrics('AAPL', 4);

      expect(result).toEqual(sampleMetrics);
      expect(mockRedis.get).toHaveBeenCalledWith(
        'research:financials:AAPL:mock',
      );
      expect(mockProvider.getFinancialMetrics).toHaveBeenCalledWith('AAPL', 4);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'research:financials:AAPL:mock',
        14400,
        JSON.stringify(sampleMetrics),
      );
    });

    it('returns cached data on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sampleMetrics));

      const result = await service.getFinancialMetrics('AAPL');

      expect(result).toEqual(sampleMetrics);
      expect(mockProvider.getFinancialMetrics).not.toHaveBeenCalled();
    });
  });

  // ── getAnalystConsensus ────────────────────────────────────────────────

  describe('getAnalystConsensus', () => {
    it('returns data from provider on cache miss with 4-hour TTL', async () => {
      mockRedis.get.mockResolvedValue(null);
      (
        mockProvider.getAnalystConsensus as ReturnType<typeof vi.fn>
      ).mockResolvedValue(sampleConsensus);

      const result = await service.getAnalystConsensus('AAPL');

      expect(result).toEqual(sampleConsensus);
      expect(mockRedis.get).toHaveBeenCalledWith(
        'research:consensus:AAPL:mock',
      );
      expect(mockProvider.getAnalystConsensus).toHaveBeenCalledWith('AAPL');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'research:consensus:AAPL:mock',
        14400,
        JSON.stringify(sampleConsensus),
      );
    });

    it('returns cached data on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sampleConsensus));

      const result = await service.getAnalystConsensus('AAPL');

      expect(result).toEqual(sampleConsensus);
      expect(mockProvider.getAnalystConsensus).not.toHaveBeenCalled();
    });

    it('uses named provider when specified', async () => {
      mockRedis.get.mockResolvedValue(null);
      (
        mockProvider.getAnalystConsensus as ReturnType<typeof vi.fn>
      ).mockResolvedValue(sampleConsensus);

      await service.getAnalystConsensus('AAPL', 'mock');

      expect(mockRegistry.getProvider).toHaveBeenCalledWith('mock');
    });
  });
});
