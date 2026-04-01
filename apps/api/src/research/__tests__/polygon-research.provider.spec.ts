import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PolygonResearchProvider } from '../providers/polygon-research.provider';

describe('PolygonResearchProvider', () => {
  let provider: PolygonResearchProvider;
  const API_KEY = 'test-polygon-api-key';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new PolygonResearchProvider({ apiKey: API_KEY });
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

  // ── getCompanyProfile ──────────────────────────────────────────────────

  describe('getCompanyProfile', () => {
    it('makes correct API call and transforms response', async () => {
      const polygonResponse = {
        results: {
          ticker: 'AAPL',
          name: 'Apple Inc.',
          description: 'Apple designs consumer electronics.',
          sic_description: 'Electronic Computers',
          homepage_url: 'https://apple.com',
          market_cap: 2800000000000,
          total_employees: 164000,
          list_date: '1980-12-12',
          primary_exchange: 'XNAS',
        },
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(polygonResponse),
      });

      const profile = await provider.getCompanyProfile('AAPL');

      // Verify the fetch URL
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain(
        'https://api.polygon.io/v3/reference/tickers/AAPL',
      );
      expect(url).toContain(`apiKey=${API_KEY}`);

      expect(profile).toEqual({
        ticker: 'AAPL',
        name: 'Apple Inc.',
        description: 'Apple designs consumer electronics.',
        sector: 'Electronic Computers',
        industry: 'Electronic Computers',
        homepageUrl: 'https://apple.com',
        marketCap: '2800000000000.00',
        employeeCount: 164000,
        listDate: '1980-12-12',
        exchange: 'XNAS',
      });
    });

    it('throws when Polygon API returns error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(provider.getCompanyProfile('AAPL')).rejects.toThrow(
        /Polygon API error/,
      );
    });

    it('handles missing optional fields gracefully', async () => {
      const polygonResponse = {
        results: {
          ticker: 'NEWCO',
          name: 'New Company',
          description: 'A new company.',
          // all optional fields missing
        },
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(polygonResponse),
      });

      const profile = await provider.getCompanyProfile('NEWCO');

      expect(profile).toEqual({
        ticker: 'NEWCO',
        name: 'New Company',
        description: 'A new company.',
        sector: '',
        industry: '',
        homepageUrl: '',
        marketCap: '0.00',
        employeeCount: 0,
        listDate: '',
        exchange: '',
      });
    });
  });

  // ── getFinancialMetrics ────────────────────────────────────────────────

  describe('getFinancialMetrics', () => {
    it('makes correct API call and transforms response', async () => {
      const polygonResponse = {
        results: [
          {
            fiscal_period: 'Q3',
            fiscal_year: '2024',
            financials: {
              income_statement: {
                revenues: { value: 94000000000 },
                net_income_loss: { value: 23600000000 },
                basic_earnings_per_share: { value: 1.53 },
                gross_profit: { value: 43000000000 },
                operating_income_loss: { value: 28000000000 },
              },
              balance_sheet: {
                assets: { value: 350000000000 },
                liabilities: { value: 280000000000 },
                equity: { value: 70000000000 },
                current_assets: { value: 140000000000 },
                current_liabilities: { value: 150000000000 },
                noncurrent_liabilities: { value: 130000000000 },
              },
              cash_flow_statement: {
                net_cash_flow_from_operating_activities: { value: 29000000000 },
                net_cash_flow_from_investing_activities: {
                  value: -10000000000,
                },
              },
            },
          },
        ],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(polygonResponse),
      });

      const metrics = await provider.getFinancialMetrics('AAPL', 4);

      // Verify the fetch URL
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain(
        'https://api.polygon.io/vX/reference/financials',
      );
      expect(url).toContain('ticker=AAPL');
      expect(url).toContain('limit=4');
      expect(url).toContain(`apiKey=${API_KEY}`);

      expect(metrics).toHaveLength(1);
      const m = metrics[0]!;
      expect(m.ticker).toBe('AAPL');
      expect(m.period).toBe('2024');
      expect(m.fiscalPeriod).toBe('Q3');
      expect(m.revenue).toBe('94000000000.00');
      expect(m.netIncome).toBe('23600000000.00');
      expect(m.eps).toBe('1.53');
      // grossMargin = 43000000000 / 94000000000
      expect(parseFloat(m.grossMargin)).toBeCloseTo(0.4574, 3);
      // currentRatio = 140000000000 / 150000000000
      expect(parseFloat(m.currentRatio)).toBeCloseTo(0.9333, 3);
      // debtToEquity = 280000000000 / 70000000000
      expect(parseFloat(m.debtToEquity)).toBeCloseTo(4.0, 1);
      // freeCashFlow = 29B + (-10B) = 19B
      expect(m.freeCashFlow).toBe('19000000000.00');
    });

    it('returns empty array when no results', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [] }),
      });

      const metrics = await provider.getFinancialMetrics('AAPL');

      expect(metrics).toEqual([]);
    });

    it('throws when Polygon API returns error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(provider.getFinancialMetrics('AAPL')).rejects.toThrow(
        /Polygon API error/,
      );
    });

    it('defaults periods to 4', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [] }),
      });

      await provider.getFinancialMetrics('AAPL');

      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('limit=4');
    });
  });

  // ── getAnalystConsensus ────────────────────────────────────────────────

  describe('getAnalystConsensus', () => {
    it('returns N/A data with computation note', async () => {
      const consensus = await provider.getAnalystConsensus('AAPL');

      // Polygon does not have this endpoint
      expect(consensus.ticker).toBe('AAPL');
      expect(consensus.recommendation).toBe('N/A');
      expect(consensus.computationNote).toContain('Polygon.io');
      // Should not call fetch since this is a static response
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
