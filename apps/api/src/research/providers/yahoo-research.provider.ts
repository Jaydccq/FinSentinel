import { Injectable, Logger } from '@nestjs/common';
import type {
  CompanyProfile,
  FinancialMetrics,
  AnalystConsensus,
} from '@finsentinel/shared';
import type { ResearchDataProvider } from '../interfaces/research-data-provider';

// ── Yahoo Finance API response shapes ────────────────────────────────────────

interface YahooQuoteSummaryResult {
  assetProfile?: {
    longBusinessSummary?: string;
    sector?: string;
    industry?: string;
    website?: string;
    fullTimeEmployees?: number;
    companyOfficers?: Array<{ name?: string; title?: string }>;
    country?: string;
  };
  price?: {
    shortName?: string;
    longName?: string;
    exchange?: string;
    marketCap?: { raw?: number };
    regularMarketPrice?: { raw?: number };
  };
  defaultKeyStatistics?: {
    trailingPE?: { raw?: number };
    priceToBook?: { raw?: number };
    enterpriseToRevenue?: { raw?: number };
  };
  financialData?: {
    currentPrice?: { raw?: number };
    targetHighPrice?: { raw?: number };
    targetLowPrice?: { raw?: number };
    targetMedianPrice?: { raw?: number };
    recommendationKey?: string;
    totalRevenue?: { raw?: number };
    revenueGrowth?: { raw?: number };
    grossMargins?: { raw?: number };
    operatingMargins?: { raw?: number };
    profitMargins?: { raw?: number };
    currentRatio?: { raw?: number };
    debtToEquity?: { raw?: number };
    returnOnEquity?: { raw?: number };
    earningsGrowth?: { raw?: number };
    freeCashflow?: { raw?: number };
    operatingCashflow?: { raw?: number };
    totalDebt?: { raw?: number };
    totalCash?: { raw?: number };
  };
  earnings?: {
    financialsChart?: {
      yearly?: Array<{
        date: number;
        revenue: { raw: number };
        earnings: { raw: number };
      }>;
    };
  };
}

interface YahooQuoteSummaryResponse {
  quoteSummary: {
    result: YahooQuoteSummaryResult[];
  };
}

/**
 * Research-data provider backed by Yahoo Finance (v10 quoteSummary API, no API key required).
 *
 * Uses modules: assetProfile, price, defaultKeyStatistics, financialData, earnings.
 */
@Injectable()
export class YahooResearchProvider implements ResearchDataProvider {
  private readonly logger = new Logger(YahooResearchProvider.name);
  private static readonly BASE_URL =
    'https://query1.finance.yahoo.com/v10/finance/quoteSummary';

  getName(): string {
    return 'yahoo';
  }

  async getCompanyProfile(ticker: string): Promise<CompanyProfile> {
    const data = await this.fetchQuoteSummary(ticker, [
      'assetProfile',
      'price',
    ]);

    const profile = data.assetProfile ?? {};
    const price = data.price ?? {};

    return {
      ticker,
      name: price.shortName ?? price.longName ?? ticker,
      description: profile.longBusinessSummary ?? '',
      sector: profile.sector ?? '',
      industry: profile.industry ?? '',
      homepageUrl: profile.website ?? '',
      marketCap: (price.marketCap?.raw ?? 0).toFixed(2),
      employeeCount: profile.fullTimeEmployees ?? 0,
      listDate: '', // Yahoo does not expose listing date in quoteSummary
      exchange: price.exchange ?? '',
    };
  }

  async getFinancialMetrics(
    ticker: string,
    periods = 4,
  ): Promise<FinancialMetrics[]> {
    const data = await this.fetchQuoteSummary(ticker, [
      'financialData',
      'defaultKeyStatistics',
      'earnings',
    ]);

    const fd = data.financialData ?? {};
    const ks = data.defaultKeyStatistics ?? {};
    const yearly = data.earnings?.financialsChart?.yearly ?? [];

    // Use yearly earnings chart for multi-period data
    if (yearly.length > 0) {
      return yearly.slice(0, periods).map((y) => ({
        ticker,
        period: `${y.date}`,
        fiscalPeriod: 'FY',
        revenue: y.revenue.raw.toFixed(2),
        netIncome: y.earnings.raw.toFixed(2),
        eps: '0.00', // Not available in yearly chart
        grossMargin: (fd.grossMargins?.raw ?? 0).toFixed(4),
        operatingMargin: (fd.operatingMargins?.raw ?? 0).toFixed(4),
        netMargin: (fd.profitMargins?.raw ?? 0).toFixed(4),
        totalAssets: '0.00', // Not available in quoteSummary
        totalLiabilities: (fd.totalDebt?.raw ?? 0).toFixed(2),
        totalEquity: '0.00',
        currentRatio: (fd.currentRatio?.raw ?? 0).toFixed(4),
        debtToEquity: ((fd.debtToEquity?.raw ?? 0) / 100).toFixed(4), // Yahoo reports as percentage
        peRatio: (ks.trailingPE?.raw ?? 0).toFixed(2),
        pbRatio: (ks.priceToBook?.raw ?? 0).toFixed(2),
        revenueGrowth: (fd.revenueGrowth?.raw ?? 0).toFixed(4),
        operatingCashFlow: (fd.operatingCashflow?.raw ?? 0).toFixed(2),
        freeCashFlow: (fd.freeCashflow?.raw ?? 0).toFixed(2),
        capitalExpenditure: '0.00',
      }));
    }

    // Fallback: single period from financialData
    return [
      {
        ticker,
        period: 'TTM',
        fiscalPeriod: 'TTM',
        revenue: (fd.totalRevenue?.raw ?? 0).toFixed(2),
        netIncome: '0.00',
        eps: '0.00',
        grossMargin: (fd.grossMargins?.raw ?? 0).toFixed(4),
        operatingMargin: (fd.operatingMargins?.raw ?? 0).toFixed(4),
        netMargin: (fd.profitMargins?.raw ?? 0).toFixed(4),
        totalAssets: '0.00',
        totalLiabilities: (fd.totalDebt?.raw ?? 0).toFixed(2),
        totalEquity: '0.00',
        currentRatio: (fd.currentRatio?.raw ?? 0).toFixed(4),
        debtToEquity: ((fd.debtToEquity?.raw ?? 0) / 100).toFixed(4),
        peRatio: (ks.trailingPE?.raw ?? 0).toFixed(2),
        pbRatio: (ks.priceToBook?.raw ?? 0).toFixed(2),
        revenueGrowth: (fd.revenueGrowth?.raw ?? 0).toFixed(4),
        operatingCashFlow: (fd.operatingCashflow?.raw ?? 0).toFixed(2),
        freeCashFlow: (fd.freeCashflow?.raw ?? 0).toFixed(2),
        capitalExpenditure: '0.00',
      },
    ];
  }

  async getAnalystConsensus(ticker: string): Promise<AnalystConsensus> {
    const data = await this.fetchQuoteSummary(ticker, ['financialData']);

    const fd = data.financialData ?? {};
    const currentPrice = fd.currentPrice?.raw ?? 0;
    const targetMedian = fd.targetMedianPrice?.raw ?? 0;
    const upsidePotential =
      currentPrice > 0
        ? ((targetMedian - currentPrice) / currentPrice) * 100
        : 0;

    return {
      ticker,
      recommendation: fd.recommendationKey ?? 'N/A',
      targetPriceHigh: (fd.targetHighPrice?.raw ?? 0).toFixed(2),
      targetPriceLow: (fd.targetLowPrice?.raw ?? 0).toFixed(2),
      targetPriceMedian: targetMedian.toFixed(2),
      currentPrice: currentPrice.toFixed(2),
      upsidePotential: upsidePotential.toFixed(2),
      computationNote: 'Data sourced from Yahoo Finance analyst estimates.',
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async fetchQuoteSummary(
    ticker: string,
    modules: string[],
  ): Promise<YahooQuoteSummaryResult> {
    const url =
      `${YahooResearchProvider.BASE_URL}/${ticker}` +
      `?modules=${modules.join(',')}`;

    this.logger.debug(`Yahoo request: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 FinSentinel/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Yahoo Finance API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as YahooQuoteSummaryResponse;
    const results = data.quoteSummary?.result;

    if (!results || results.length === 0) {
      throw new Error(`No data available for ticker ${ticker}`);
    }

    return results[0]!;
  }
}
