import { z } from 'zod';

// --- ScreenerCriteria ---
export const screenerCriteriaSchema = z.object({
  sector: z.string().optional(),
  exchange: z.string().optional(),
  marketCapMin: z.string().optional(),
  marketCapMax: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.string().default('market_cap'),
  order: z.string().default('desc'),
  limit: z.number().int().min(1).max(50).default(20),
});
export type ScreenerCriteria = z.infer<typeof screenerCriteriaSchema>;

// --- ScreenerResult ---
export const screenerResultSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  primaryExchange: z.string(),
  type: z.string(),
  locale: z.string(),
  marketCap: z.string(),
  currencyName: z.string(),
  active: z.boolean(),
});
export type ScreenerResult = z.infer<typeof screenerResultSchema>;

// --- CompanyProfile ---
export const companyProfileSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  description: z.string(),
  sector: z.string(),
  industry: z.string(),
  homepageUrl: z.string(),
  marketCap: z.string(),
  employeeCount: z.number().int(),
  listDate: z.string(),
  exchange: z.string(),
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

// --- FinancialMetrics ---
export const financialMetricsSchema = z.object({
  ticker: z.string(),
  period: z.string(),
  fiscalPeriod: z.string(),
  revenue: z.string(),
  netIncome: z.string(),
  eps: z.string(),
  grossMargin: z.string(),
  operatingMargin: z.string(),
  netMargin: z.string(),
  totalAssets: z.string(),
  totalLiabilities: z.string(),
  totalEquity: z.string(),
  currentRatio: z.string(),
  debtToEquity: z.string(),
  peRatio: z.string(),
  pbRatio: z.string(),
  revenueGrowth: z.string(),
  operatingCashFlow: z.string(),
  freeCashFlow: z.string(),
  capitalExpenditure: z.string(),
});
export type FinancialMetrics = z.infer<typeof financialMetricsSchema>;

// --- AnalystConsensus ---
export const analystConsensusSchema = z.object({
  ticker: z.string(),
  recommendation: z.string(),
  targetPriceHigh: z.string(),
  targetPriceLow: z.string(),
  targetPriceMedian: z.string(),
  currentPrice: z.string(),
  upsidePotential: z.string(),
  computationNote: z.string(),
});
export type AnalystConsensus = z.infer<typeof analystConsensusSchema>;
