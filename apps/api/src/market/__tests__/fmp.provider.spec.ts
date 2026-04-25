import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FmpMarketDataProvider } from '../providers/fmp.provider';
import { YahooFinanceMarketDataProvider } from '../providers/yahoo.provider';

// ── FmpMarketDataProvider ──────────────────────────────────────────────────

describe('FmpMarketDataProvider', () => {
  let provider: FmpMarketDataProvider;
  const API_KEY = 'test-fmp-api-key';
  const BASE_URL = 'https://financialmodelingprep.com/api/v3';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new FmpMarketDataProvider({ apiKey: API_KEY, baseUrl: BASE_URL });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── getName ─────────────────────────────────────────────────────────────

  describe('getName', () => {
    it('returns "fmp"', () => {
      expect(provider.getName()).toBe('fmp');
    });
  });

  // ── supports ────────────────────────────────────────────────────────────

  describe('supports', () => {
    it('returns true for any ticker', () => {
      expect(provider.supports('AAPL')).toBe(true);
      expect(provider.supports('TSLA')).toBe(true);
    });
  });

  // ── getQuote ────────────────────────────────────────────────────────────

  describe('getQuote', () => {
    it('makes correct API call and transforms response', async () => {
      const fmpResponse = [
        {
          symbol: 'AAPL',
          open: 148.0,
          dayHigh: 155.0,
          dayLow: 147.5,
          price: 153.5,
          volume: 50000000,
          timestamp: 1700245600,
        },
      ];

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(fmpResponse),
      });

      const quote = await provider.getQuote('AAPL');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toBe(`${BASE_URL}/quote/AAPL?apikey=${API_KEY}`);

      expect(quote).toEqual({
        ticker: 'AAPL',
        open: '148.00',
        high: '155.00',
        low: '147.50',
        close: '153.50',
        volume: 50000000,
        timestamp: 1700245600000, // seconds * 1000
      });
    });

    it('throws when FMP API returns error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(provider.getQuote('AAPL')).rejects.toThrow(/FMP API error/);
    });

    it('throws when no data returned', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      await expect(provider.getQuote('AAPL')).rejects.toThrow(/No data/);
    });
  });

  // ── getHistoricalBars ─────────────────────────────────────────────────

  describe('getHistoricalBars', () => {
    it('fetches correct URL and transforms response', async () => {
      const fmpResponse = {
        symbol: 'AAPL',
        historical: [
          {
            date: '2024-11-16',
            open: 153.5,
            high: 156.0,
            low: 152.0,
            close: 154.0,
            volume: 45000000,
          },
          {
            date: '2024-11-15',
            open: 150.0,
            high: 155.0,
            low: 149.0,
            close: 153.5,
            volume: 50000000,
          },
        ],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(fmpResponse),
      });

      const bars = await provider.getHistoricalBars('AAPL', 30);

      // Verify URL contains required parts
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain(`${BASE_URL}/historical-price-full/AAPL`);
      expect(url).toContain(`apikey=${API_KEY}`);
      expect(url).toContain('from=');
      expect(url).toContain('to=');

      // Should sort ascending by date
      expect(bars).toEqual([
        {
          open: '150.00',
          high: '155.00',
          low: '149.00',
          close: '153.50',
          volume: 50000000,
          timestamp: new Date('2024-11-15').getTime(),
        },
        {
          open: '153.50',
          high: '156.00',
          low: '152.00',
          close: '154.00',
          volume: 45000000,
          timestamp: new Date('2024-11-16').getTime(),
        },
      ]);
    });

    it('throws when FMP API returns error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(provider.getHistoricalBars('AAPL', 30)).rejects.toThrow(/FMP API error/);
    });

    it('throws when no historical data returned', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ symbol: 'AAPL', historical: [] }),
      });

      await expect(provider.getHistoricalBars('AAPL', 30)).rejects.toThrow(/No historical data/);
    });
  });

  // ── searchTickers ─────────────────────────────────────────────────────

  describe('searchTickers', () => {
    it('maps FMP /search response to TickerSearchResult', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            symbol: 'AAPL',
            name: 'Apple Inc.',
            currency: 'USD',
            stockExchange: 'NASDAQ Global Select',
            exchangeShortName: 'NASDAQ',
          },
          {
            symbol: 'AAPL.NE',
            name: 'Apple Neo Exchange',
            exchangeShortName: 'NEO',
          },
        ]),
      });

      const results = await provider.searchTickers('app', 10);
      const call = fetchMock.mock.calls[0]![0] as string;
      expect(call).toContain('/search');
      expect(call).toContain('query=app');
      expect(call).toContain('limit=10');
      expect(results).toEqual([
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', assetType: 'EQUITY' },
        { symbol: 'AAPL.NE', name: 'Apple Neo Exchange', exchange: 'NEO', assetType: 'EQUITY' },
      ]);
    });

    it('returns [] on non-2xx (no throw — caller will fall back)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
      await expect(provider.searchTickers('x', 5)).resolves.toEqual([]);
    });
  });
});

// ── YahooFinanceMarketDataProvider ──────────────────────────────────────────

describe('YahooFinanceMarketDataProvider', () => {
  let provider: YahooFinanceMarketDataProvider;
  const BASE_URL = 'https://query1.finance.yahoo.com';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new YahooFinanceMarketDataProvider({ baseUrl: BASE_URL });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── getName ─────────────────────────────────────────────────────────────

  describe('getName', () => {
    it('returns "yahoo"', () => {
      expect(provider.getName()).toBe('yahoo');
    });
  });

  // ── supports ────────────────────────────────────────────────────────────

  describe('supports', () => {
    it('returns true for any ticker', () => {
      expect(provider.supports('AAPL')).toBe(true);
      expect(provider.supports('BTC-USD')).toBe(true);
    });
  });

  // ── getQuote ────────────────────────────────────────────────────────────

  describe('getQuote', () => {
    it('makes correct API call and transforms response', async () => {
      const yahooResponse = {
        chart: {
          result: [
            {
              meta: {
                symbol: 'AAPL',
                regularMarketPrice: 153.5,
                chartPreviousClose: 148.0,
              },
              timestamp: [1700159200, 1700245600],
              indicators: {
                quote: [
                  {
                    open: [147.0, 148.0],
                    high: [149.0, 155.0],
                    low: [146.0, 147.5],
                    close: [148.0, 153.5],
                    volume: [38000000, 50000000],
                  },
                ],
              },
            },
          ],
          error: null,
        },
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(yahooResponse),
      });

      const quote = await provider.getQuote('AAPL');

      // Verify the fetch URL
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain(`${BASE_URL}/v8/finance/chart/AAPL`);
      expect(url).toContain('range=5d');
      expect(url).toContain('interval=1d');

      // Verify User-Agent header
      const options = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(options.headers).toEqual(
        expect.objectContaining({ 'User-Agent': expect.stringContaining('Mozilla') }),
      );

      // Should return the LAST data point
      expect(quote).toEqual({
        ticker: 'AAPL',
        open: '148.00',
        high: '155.00',
        low: '147.50',
        close: '153.50',
        volume: 50000000,
        timestamp: 1700245600000, // seconds * 1000
      });
    });

    it('throws when Yahoo API returns error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(provider.getQuote('AAPL')).rejects.toThrow(/Yahoo Finance API error/);
    });

    it('throws when chart error is present', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chart: {
            result: null,
            error: { code: 'Not Found', description: 'No data found for ticker FAKE' },
          },
        }),
      });

      await expect(provider.getQuote('FAKE')).rejects.toThrow(/Yahoo Finance error/);
    });

    it('throws when no results returned', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chart: { result: [], error: null },
        }),
      });

      await expect(provider.getQuote('AAPL')).rejects.toThrow(/No data/);
    });

    it('throws when quote values are null', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chart: {
            result: [
              {
                meta: { symbol: 'AAPL', regularMarketPrice: 0, chartPreviousClose: 0 },
                timestamp: [1700245600],
                indicators: {
                  quote: [
                    { open: [null], high: [null], low: [null], close: [null], volume: [null] },
                  ],
                },
              },
            ],
            error: null,
          },
        }),
      });

      await expect(provider.getQuote('AAPL')).rejects.toThrow(/Incomplete quote data/);
    });
  });

  // ── getHistoricalBars ─────────────────────────────────────────────────

  describe('getHistoricalBars', () => {
    it('fetches bars and skips null entries', async () => {
      const yahooResponse = {
        chart: {
          result: [
            {
              meta: { symbol: 'AAPL', regularMarketPrice: 154.0, chartPreviousClose: 150.0 },
              timestamp: [1700000000, 1700086400, 1700172800],
              indicators: {
                quote: [
                  {
                    open: [150.0, null, 153.5],
                    high: [155.0, null, 156.0],
                    low: [149.0, null, 152.0],
                    close: [153.5, null, 154.0],
                    volume: [50000000, null, 45000000],
                  },
                ],
              },
            },
          ],
          error: null,
        },
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(yahooResponse),
      });

      const bars = await provider.getHistoricalBars('AAPL', 30);

      // Verify URL uses correct range
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('range=1mo');

      // Should skip the null entry (index 1)
      expect(bars).toHaveLength(2);
      expect(bars[0]).toEqual({
        open: '150.00',
        high: '155.00',
        low: '149.00',
        close: '153.50',
        volume: 50000000,
        timestamp: 1700000000000,
      });
      expect(bars[1]).toEqual({
        open: '153.50',
        high: '156.00',
        low: '152.00',
        close: '154.00',
        volume: 45000000,
        timestamp: 1700172800000,
      });
    });

    it('maps days to correct Yahoo range parameter', async () => {
      const makeResponse = () => ({
        chart: {
          result: [
            {
              meta: { symbol: 'X', regularMarketPrice: 1, chartPreviousClose: 1 },
              timestamp: [1700000000],
              indicators: {
                quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [100] }],
              },
            },
          ],
          error: null,
        },
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeResponse()),
      });

      // 5 days -> 5d
      await provider.getHistoricalBars('X', 5);
      expect(fetchMock.mock.calls[0]![0] as string).toContain('range=5d');

      // 90 days -> 3mo
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeResponse()),
      });
      await provider.getHistoricalBars('X', 90);
      expect(fetchMock.mock.calls[1]![0] as string).toContain('range=3mo');

      // 365 days -> 1y
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeResponse()),
      });
      await provider.getHistoricalBars('X', 365);
      expect(fetchMock.mock.calls[2]![0] as string).toContain('range=1y');
    });

    it('throws when all data points are null', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chart: {
            result: [
              {
                meta: { symbol: 'X', regularMarketPrice: 0, chartPreviousClose: 0 },
                timestamp: [1700000000],
                indicators: {
                  quote: [
                    { open: [null], high: [null], low: [null], close: [null], volume: [null] },
                  ],
                },
              },
            ],
            error: null,
          },
        }),
      });

      await expect(provider.getHistoricalBars('X', 30)).rejects.toThrow(/No historical data/);
    });
  });
});
