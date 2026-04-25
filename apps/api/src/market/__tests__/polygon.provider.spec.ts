import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PolygonMarketDataProvider } from '../providers/polygon.provider';

describe('PolygonMarketDataProvider', () => {
  let provider: PolygonMarketDataProvider;
  const API_KEY = 'test-polygon-api-key';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new PolygonMarketDataProvider({ apiKey: API_KEY });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── getName ─────────────────────────────────────────────────────────────

  describe('getName', () => {
    it('returns "polygon"', () => {
      expect(provider.getName()).toBe('polygon');
    });
  });

  // ── supports ────────────────────────────────────────────────────────────

  describe('supports', () => {
    it('returns true for any ticker', () => {
      expect(provider.supports('AAPL')).toBe(true);
      expect(provider.supports('BTC-USD')).toBe(true);
      expect(provider.supports('X:BTCUSD')).toBe(true);
    });
  });

  // ── getQuote ────────────────────────────────────────────────────────────

  describe('getQuote', () => {
    it('makes correct API call and transforms response', async () => {
      const polygonResponse = {
        resultsCount: 5,
        results: [
          { o: 140.0, h: 145.0, l: 139.0, c: 142.0, v: 40000000, t: 1699900000000 },
          { o: 142.0, h: 146.0, l: 141.0, c: 143.5, v: 42000000, t: 1699986400000 },
          { o: 143.5, h: 148.0, l: 143.0, c: 147.0, v: 45000000, t: 1700072800000 },
          { o: 147.0, h: 149.0, l: 146.0, c: 148.0, v: 38000000, t: 1700159200000 },
          { o: 148.0, h: 155.0, l: 147.5, c: 153.5, v: 50000000, t: 1700245600000 },
        ],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(polygonResponse),
      });

      const quote = await provider.getQuote('AAPL');

      // Verify the fetch URL pattern
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/');
      expect(url).toContain(`apiKey=${API_KEY}`);

      // Should return the LAST bar as the quote
      expect(quote).toEqual({
        ticker: 'AAPL',
        open: '148.00',
        high: '155.00',
        low: '147.50',
        close: '153.50',
        volume: 50000000,
        timestamp: 1700245600000,
      });
    });

    it('throws when Polygon API returns error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(provider.getQuote('AAPL')).rejects.toThrow(/Polygon API error/);
    });

    it('throws when no results returned', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ resultsCount: 0, results: [] }),
      });

      await expect(provider.getQuote('AAPL')).rejects.toThrow(/No data/);
    });

    it('maps crypto spot tickers to Polygon native symbols', async () => {
      const polygonResponse = {
        resultsCount: 1,
        results: [{ o: 65000.0, h: 66000.0, l: 64000.0, c: 65500.0, v: 1200, t: 1700245600000 }],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(polygonResponse),
      });

      await provider.getQuote('BTC-USD');

      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('/v2/aggs/ticker/X:BTCUSD/range/1/day/');
    });
  });

  // ── getHistoricalBars ─────────────────────────────────────────────────

  describe('getHistoricalBars', () => {
    it('fetches correct date range and transforms bars', async () => {
      const polygonResponse = {
        resultsCount: 2,
        results: [
          { o: 150.0, h: 155.0, l: 149.0, c: 153.5, v: 50000000, t: 1700000000000 },
          { o: 153.5, h: 156.0, l: 152.0, c: 154.0, v: 45000000, t: 1700086400000 },
        ],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(polygonResponse),
      });

      const bars = await provider.getHistoricalBars('AAPL', 30);

      // Verify URL
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/');
      expect(url).toContain(`apiKey=${API_KEY}`);

      // Verify the date range spans ~30 days
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      // Path: /v2/aggs/ticker/AAPL/range/1/day/{from}/{to}
      const fromDate = pathParts[8]!;
      const toDate = pathParts[9]!;
      const fromMs = new Date(fromDate).getTime();
      const toMs = new Date(toDate).getTime();
      const daysDiff = (toMs - fromMs) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeCloseTo(30, 0);

      // Verify transformation
      expect(bars).toEqual([
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
      ]);
    });

    it('throws when Polygon API returns error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(provider.getHistoricalBars('AAPL', 30)).rejects.toThrow(/Polygon API error/);
    });
  });

  // ── searchTickers ──────────────────────────────────────────────────────

  describe('searchTickers', () => {
    it('maps Polygon /v3/reference/tickers response to TickerSearchResult', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              ticker: 'AAPL',
              name: 'Apple Inc.',
              primary_exchange: 'XNAS',
              market: 'stocks',
              type: 'CS',
            },
            {
              ticker: 'AAP',
              name: 'Advance Auto Parts Inc.',
              primary_exchange: 'XNYS',
              market: 'stocks',
              type: 'CS',
            },
          ],
        }),
      });

      const results = await provider.searchTickers('app', 10);

      const call = fetchMock.mock.calls[0]![0] as string;
      expect(call).toContain('/v3/reference/tickers');
      expect(call).toContain('search=app');
      expect(call).toContain('active=true');
      expect(call).toContain('limit=10');

      expect(results).toEqual([
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'XNAS', assetType: 'CS' },
        { symbol: 'AAP', name: 'Advance Auto Parts Inc.', exchange: 'XNYS', assetType: 'CS' },
      ]);
    });

    it('returns [] on non-2xx (no throw — caller will fall back)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' });
      await expect(provider.searchTickers('x', 5)).resolves.toEqual([]);
    });

    it('tolerates missing primary_exchange / type fields', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{ ticker: 'WEIRD', name: 'Weird Ltd', market: 'crypto' }],
        }),
      });
      const results = await provider.searchTickers('weird', 5);
      expect(results).toEqual([
        { symbol: 'WEIRD', name: 'Weird Ltd', exchange: 'crypto', assetType: 'crypto' },
      ]);
    });
  });
});
