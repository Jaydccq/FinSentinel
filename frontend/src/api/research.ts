import { apiFetch } from './client'

export interface CompanyProfile {
  ticker: string
  name: string
  description: string
  sector: string
  industry: string
  homepageUrl: string
  marketCap: number
  employeeCount: number
  listDate: string
  exchange: string
}

export interface FinancialMetrics {
  ticker: string
  period: string
  fiscalPeriod: string
  revenue: number | null
  netIncome: number | null
  eps: number | null
  grossMargin: number | null
  operatingMargin: number | null
  netMargin: number | null
  peRatio: number | null
  pbRatio: number | null
  revenueGrowth: number | null
  totalAssets: number | null
  totalLiabilities: number | null
  totalEquity: number | null
  currentRatio: number | null
  debtToEquity: number | null
  operatingCashFlow: number | null
  freeCashFlow: number | null
  capitalExpenditure: number | null
}

export const researchApi = {
  profile: (ticker: string) => apiFetch<CompanyProfile>(`/research/profile/${ticker}`),
  financials: (ticker: string, periods = 4) =>
    apiFetch<FinancialMetrics[]>(`/research/financials/${ticker}?periods=${periods}`),
}
