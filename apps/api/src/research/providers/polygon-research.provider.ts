import { Injectable, Logger } from '@nestjs/common';
import type {
  CompanyProfile,
  FinancialMetrics,
  AnalystConsensus,
} from '@finsentinel/shared';
import type { ResearchDataProvider } from '../interfaces/research-data-provider';

// ── Polygon API response shapes ──────────────────────────────────────────────

interface PolygonTickerDetails {
  results: {
    ticker: string;
    name: string;
    description: string;
    sic_description?: string;
    homepage_url?: string;
    market_cap?: number;
    total_employees?: number;
    list_date?: string;
    primary_exchange?: string;
    /** Polygon uses sector/industry from SIC codes */
    type?: string;
  };
}

interface PolygonFinancialResult {
  fiscal_period: string;
  fiscal_year: string;
  financials: {
    income_statement?: {
      revenues?: { value: number };
      net_income_loss?: { value: number };
      basic_earnings_per_share?: { value: number };
      gross_profit?: { value: number };
      operating_income_loss?: { value: number };
    };
    balance_sheet?: {
      assets?: { value: number };
      liabilities?: { value: number };
      equity?: { value: number };
      current_assets?: { value: number };
      current_liabilities?: { value: number };
      noncurrent_liabilities?: { value: number };
    };
    cash_flow_statement?: {
      net_cash_flow_from_operating_activities?: { value: number };
      net_cash_flow_from_investing_activities?: { value: number };
    };
  };
}

interface PolygonFinancialsResponse {
  results: PolygonFinancialResult[];
}

/** Configuration injected into the provider. */
export interface PolygonResearchProviderConfig {
  apiKey: string;
}

/**
 * Research-data provider backed by the Polygon.io Reference API.
 *
 * - Company profile: GET /v3/reference/tickers/{ticker}
 * - Financials:      GET /vX/reference/financials?ticker={ticker}&limit={periods}
 * - Analyst consensus: computed from financial metrics (Polygon lacks a dedicated endpoint)
 */
@Injectable()
export class PolygonResearchProvider implements ResearchDataProvider {
  private readonly logger = new Logger(PolygonResearchProvider.name);
  private readonly apiKey: string;
  private static readonly BASE_URL = 'https://api.polygon.io';

  constructor(config: PolygonResearchProviderConfig) {
    this.apiKey = config.apiKey;
  }

  getName(): string {
    return 'polygon';
  }

  async getCompanyProfile(ticker: string): Promise<CompanyProfile> {
    const url =
      `${PolygonResearchProvider.BASE_URL}/v3/reference/tickers/${ticker}` +
      `?apiKey=${this.apiKey}`;

    this.logger.debug(
      `Polygon request: ${url.replace(this.apiKey, '***')}`,
    );

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Polygon API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as PolygonTickerDetails;
    const r = data.results;

    return {
      ticker: r.ticker,
      name: r.name,
      description: r.description ?? '',
      sector: r.sic_description ?? '',
      industry: r.sic_description ?? '',
      homepageUrl: r.homepage_url ?? '',
      marketCap: (r.market_cap ?? 0).toFixed(2),
      employeeCount: r.total_employees ?? 0,
      listDate: r.list_date ?? '',
      exchange: r.primary_exchange ?? '',
    };
  }

  async getFinancialMetrics(
    ticker: string,
    periods = 4,
  ): Promise<FinancialMetrics[]> {
    const url =
      `${PolygonResearchProvider.BASE_URL}/vX/reference/financials` +
      `?ticker=${ticker}&limit=${periods}&apiKey=${this.apiKey}`;

    this.logger.debug(
      `Polygon request: ${url.replace(this.apiKey, '***')}`,
    );

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Polygon API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as PolygonFinancialsResponse;

    if (!data.results || data.results.length === 0) {
      return [];
    }

    return data.results.map((r) => this.mapFinancialResult(ticker, r));
  }

  async getAnalystConsensus(ticker: string): Promise<AnalystConsensus> {
    // Polygon.io does not have a dedicated analyst consensus endpoint.
    // Return a computed note indicating this limitation.
    return {
      ticker,
      recommendation: 'N/A',
      targetPriceHigh: '0.00',
      targetPriceLow: '0.00',
      targetPriceMedian: '0.00',
      currentPrice: '0.00',
      upsidePotential: '0.00',
      computationNote:
        'Polygon.io does not provide analyst consensus data. Use Yahoo provider for this metric.',
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private mapFinancialResult(
    ticker: string,
    r: PolygonFinancialResult,
  ): FinancialMetrics {
    const is = r.financials.income_statement ?? {};
    const bs = r.financials.balance_sheet ?? {};
    const cf = r.financials.cash_flow_statement ?? {};

    const revenue = is.revenues?.value ?? 0;
    const netIncome = is.net_income_loss?.value ?? 0;
    const grossProfit = is.gross_profit?.value ?? 0;
    const operatingIncome = is.operating_income_loss?.value ?? 0;
    const totalAssets = bs.assets?.value ?? 0;
    const totalLiabilities = bs.liabilities?.value ?? 0;
    const totalEquity = bs.equity?.value ?? 0;
    const currentAssets = bs.current_assets?.value ?? 0;
    const currentLiabilities = bs.current_liabilities?.value ?? 0;
    const operatingCashFlow =
      cf.net_cash_flow_from_operating_activities?.value ?? 0;
    const capex = cf.net_cash_flow_from_investing_activities?.value ?? 0;

    const grossMargin = revenue !== 0 ? grossProfit / revenue : 0;
    const operatingMargin = revenue !== 0 ? operatingIncome / revenue : 0;
    const netMargin = revenue !== 0 ? netIncome / revenue : 0;
    const currentRatio =
      currentLiabilities !== 0 ? currentAssets / currentLiabilities : 0;
    const debtToEquity =
      totalEquity !== 0 ? totalLiabilities / totalEquity : 0;

    return {
      ticker,
      period: `${r.fiscal_year}`,
      fiscalPeriod: r.fiscal_period,
      revenue: revenue.toFixed(2),
      netIncome: netIncome.toFixed(2),
      eps: (is.basic_earnings_per_share?.value ?? 0).toFixed(2),
      grossMargin: grossMargin.toFixed(4),
      operatingMargin: operatingMargin.toFixed(4),
      netMargin: netMargin.toFixed(4),
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      currentRatio: currentRatio.toFixed(4),
      debtToEquity: debtToEquity.toFixed(4),
      peRatio: '0.00', // Requires market price; not available from financials endpoint
      pbRatio: '0.00',
      revenueGrowth: '0.00', // Requires multi-period comparison
      operatingCashFlow: operatingCashFlow.toFixed(2),
      freeCashFlow: (operatingCashFlow + capex).toFixed(2),
      capitalExpenditure: capex.toFixed(2),
    };
  }
}
