import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MarketDataService } from '../market-data.service';
import { MarketDataProviderRegistry } from '../market-data-provider.registry';
import type { MarketDataProvider } from '../interfaces/market-data-provider';
import type { MarketQuote, MarketBar, TickerSearchResult } from '@finsentinel/shared';

// ── Mock Redis ──────────────────────────────────────────────────────────────
function createMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  };
}

// ── Mock Provider ───────────────────────────────────────────────────────────
function createMockProvider(): MarketDataProvider {
  return {
    getName: vi.fn().mockReturnValue('mock'),
    getQuote: vi.fn(),
    getHistoricalBars: vi.fn(),
    supports: vi.fn().mockReturnValue(true),
  };
}

describe('MarketDataService', () => {
  let service: MarketDataService;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockProvider: MarketDataProvider;
  let mockRegistry: { getDefaultProvider: ReturnType<typeof vi.fn> };

  const sampleQuote: MarketQuote = {
    ticker: 'AAPL',
    open: '150.00',
    high: '155.00',
    low: '149.00',
    close: '153.50',
    volume: 50000000,
    timestamp: 1700000000000,
  };

  const sampleBars: MarketBar[] = [
    {
      open: '150.00',
      high: '155.00',
      low: '149.00',
      close: '153.50',
      volume: 50000000,
      timestamp: 1700000000000,
    },
    {
      open: '153.50',
      high: '156.00',
      low: '152.00',
      close: '154.00',
      volume: 45000000,
      timestamp: 1700086400000,
    },
  ];

  const sampleSearchResults: TickerSearchResult[] = [
    { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', assetType: 'Equity' },
    { symbol: 'AAPX', name: 'T. Rowe Price Blue Chip Growth', exchange: 'NYSE', assetType: 'ETF' },
  ];

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockProvider = createMockProvider();
    mockRegistry = {
      getDefaultProvider: vi.fn().mockReturnValue(mockProvider),
    };

    const module = await Test.createTestingModule({
      providers: [
        MarketDataService,
        {
          provide: MarketDataProviderRegistry,
          useValue: mockRegistry,
        },
        {
          provide: 'REDIS',
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get(MarketDataService);
  });

  // ── getQuote ──────────────────────────────────────────────────────────────

  describe('getQuote', () => {
    it('returns data from provider on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      (mockProvider.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

      const result = await service.getQuote('AAPL');

      expect(result).toEqual(sampleQuote);
      expect(mockRedis.get).toHaveBeenCalledWith('market:quote:AAPL');
      expect(mockProvider.getQuote).toHaveBeenCalledWith('AAPL');
      // Cache with 5-min TTL (300 seconds)
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'market:quote:AAPL',
        300,
        JSON.stringify(sampleQuote),
      );
    });

    it('returns cached data on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sampleQuote));

      const result = await service.getQuote('AAPL');

      expect(result).toEqual(sampleQuote);
      expect(mockProvider.getQuote).not.toHaveBeenCalled();
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on invalid ticker', async () => {
      await expect(service.getQuote('INVALID TICKER!!')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockProvider.getQuote).not.toHaveBeenCalled();
    });

    it('uppercases ticker in cache key', async () => {
      mockRedis.get.mockResolvedValue(null);
      (mockProvider.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

      await service.getQuote('aapl');

      expect(mockRedis.get).toHaveBeenCalledWith('market:quote:AAPL');
      expect(mockProvider.getQuote).toHaveBeenCalledWith('AAPL');
    });
  });

  // ── getHistoricalBars ─────────────────────────────────────────────────────

  describe('getHistoricalBars', () => {
    it('returns data from provider on cache miss with 30-min TTL', async () => {
      mockRedis.get.mockResolvedValue(null);
      (mockProvider.getHistoricalBars as ReturnType<typeof vi.fn>).mockResolvedValue(sampleBars);

      const result = await service.getHistoricalBars('AAPL', 30);

      expect(result).toEqual(sampleBars);
      expect(mockRedis.get).toHaveBeenCalledWith('market:bars:AAPL:30');
      expect(mockProvider.getHistoricalBars).toHaveBeenCalledWith('AAPL', 30);
      // Cache with 30-min TTL (1800 seconds)
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'market:bars:AAPL:30',
        1800,
        JSON.stringify(sampleBars),
      );
    });

    it('returns cached data on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sampleBars));

      const result = await service.getHistoricalBars('AAPL', 30);

      expect(result).toEqual(sampleBars);
      expect(mockProvider.getHistoricalBars).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on invalid ticker', async () => {
      await expect(service.getHistoricalBars('$$$BAD$$$', 30)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── searchTickers ─────────────────────────────────────────────────────────

  describe('searchTickers', () => {
    it('returns results with 10-min TTL (600s)', async () => {
      // Mock the global fetch for Yahoo search
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          quotes: [
            { symbol: 'AAPL', shortname: 'Apple Inc.', exchange: 'NMS', quoteType: 'EQUITY' },
            { symbol: 'AAPX', shortname: 'T. Rowe Price Blue Chip Growth', exchange: 'NYQ', quoteType: 'ETF' },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      mockRedis.get.mockResolvedValue(null);

      const result = await service.searchTickers('AAP');

      expect(result).toEqual([
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NMS', assetType: 'EQUITY' },
        { symbol: 'AAPX', name: 'T. Rowe Price Blue Chip Growth', exchange: 'NYQ', assetType: 'ETF' },
      ]);
      expect(mockRedis.get).toHaveBeenCalledWith('market:search:AAP');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'market:search:AAP',
        600,
        expect.any(String),
      );

      vi.unstubAllGlobals();
    });

    it('returns cached results on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sampleSearchResults));

      const result = await service.searchTickers('AAP');

      expect(result).toEqual(sampleSearchResults);

      // fetch should not be called
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
      expect(mockFetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
