import { apiFetch } from './client';

export interface CompanyProfile {
  ticker: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  homepageUrl: string;
  marketCap: number;
  employeeCount: number;
  listDate: string;
  exchange: string;
}

export interface FinancialMetrics {
  ticker: string;
  period: string;
  fiscalPeriod: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  revenueGrowth: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  capitalExpenditure: number | null;
}

interface RawCompanyProfile {
  ticker: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  homepageUrl: string;
  marketCap: number | string;
  employeeCount: number;
  listDate: string;
  exchange: string;
}

interface RawFinancialMetrics {
  ticker: string;
  period: string;
  fiscalPeriod: string;
  revenue: number | string | null;
  netIncome: number | string | null;
  eps: number | string | null;
  grossMargin: number | string | null;
  operatingMargin: number | string | null;
  netMargin: number | string | null;
  peRatio: number | string | null;
  pbRatio: number | string | null;
  revenueGrowth: number | string | null;
  totalAssets: number | string | null;
  totalLiabilities: number | string | null;
  totalEquity: number | string | null;
  currentRatio: number | string | null;
  debtToEquity: number | string | null;
  operatingCashFlow: number | string | null;
  freeCashFlow: number | string | null;
  capitalExpenditure: number | string | null;
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNullableNumber(value: number | string | null): number | null {
  if (value == null) return null;
  return toNumber(value);
}

function normalizeCompanyProfile(raw: RawCompanyProfile): CompanyProfile {
  return {
    ticker: raw.ticker,
    name: raw.name,
    description: raw.description,
    sector: raw.sector,
    industry: raw.industry,
    homepageUrl: raw.homepageUrl,
    marketCap: toNumber(raw.marketCap),
    employeeCount: raw.employeeCount,
    listDate: raw.listDate,
    exchange: raw.exchange,
  };
}

function normalizeFinancialMetrics(raw: RawFinancialMetrics): FinancialMetrics {
  return {
    ticker: raw.ticker,
    period: raw.period,
    fiscalPeriod: raw.fiscalPeriod,
    revenue: toNullableNumber(raw.revenue),
    netIncome: toNullableNumber(raw.netIncome),
    eps: toNullableNumber(raw.eps),
    grossMargin: toNullableNumber(raw.grossMargin),
    operatingMargin: toNullableNumber(raw.operatingMargin),
    netMargin: toNullableNumber(raw.netMargin),
    peRatio: toNullableNumber(raw.peRatio),
    pbRatio: toNullableNumber(raw.pbRatio),
    revenueGrowth: toNullableNumber(raw.revenueGrowth),
    totalAssets: toNullableNumber(raw.totalAssets),
    totalLiabilities: toNullableNumber(raw.totalLiabilities),
    totalEquity: toNullableNumber(raw.totalEquity),
    currentRatio: toNullableNumber(raw.currentRatio),
    debtToEquity: toNullableNumber(raw.debtToEquity),
    operatingCashFlow: toNullableNumber(raw.operatingCashFlow),
    freeCashFlow: toNullableNumber(raw.freeCashFlow),
    capitalExpenditure: toNullableNumber(raw.capitalExpenditure),
  };
}

export const researchApi = {
  profile: async (ticker: string) =>
    normalizeCompanyProfile(await apiFetch<RawCompanyProfile>(`/research/profile/${ticker}`)),
  financials: async (ticker: string, periods = 4) =>
    (
      await apiFetch<RawFinancialMetrics[]>(`/research/financials/${ticker}?periods=${periods}`)
    ).map(normalizeFinancialMetrics),
};
