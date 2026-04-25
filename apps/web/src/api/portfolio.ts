import { apiFetch } from './client';
import type { RiskFactor } from './chat';

export interface RiskReportSummary {
  id: string;
  riskScore: number;
  riskLevel: string;
  summary: string;
  factors: RiskFactor[];
  actionableAdvice: string[];
  createdAt: string;
}

export interface HoldingResponse {
  id: string;
  symbol: string;
  companyName: string;
  quantity: number;
  averageCost: number;
  currentPrice: number | null;
  sector: string;
}

export interface PortfolioResponse {
  id: string;
  name: string;
  description: string;
  totalValue: number;
  holdings: HoldingResponse[];
  createdAt: string;
}

export interface PortfolioRequest {
  name: string;
  description?: string;
}

export interface HoldingRequest {
  symbol: string;
  companyName?: string;
  quantity: number;
  averageCost: number;
  sector?: string;
}

export interface HoldingWeight {
  symbol: string;
  companyName: string;
  sector: string;
  marketValue: number;
  weightPercent: number;
  unrealizedPnl: number;
  pnlPercent: number;
}

export interface PortfolioAnalytics {
  totalMarketValue: number;
  sectorAllocation: Record<string, number>;
  hhiIndex: number;
  hhiClassification: string;
  holdingWeights: HoldingWeight[];
  concentrationWarnings: string[];
}

export interface RelevantEvent {
  headline: string;
  source: string;
  publishedAt: string;
  impactedSymbols: string[];
  relevanceReason: string;
}

export interface PortfolioInsight {
  portfolioId: string;
  generatedAt: string;
  freshness: 'full' | 'degraded' | 'empty';
  riskScore: number;
  riskLevel: string;
  hhiIndex: number;
  hhiClassification: string;
  topHoldingSymbol: string | null;
  topHoldingWeightPercent: string | null;
  sectorCount: number;
  concentrationWarnings: string[];
  holdingCount: number;
  relevantEvents: RelevantEvent[];
  priorityActions: string[];
  narration: string | null;
  narrationFailed: boolean;
}

export const portfolioApi = {
  list: () => apiFetch<PortfolioResponse[]>('/portfolios'),
  get: (id: string) => apiFetch<PortfolioResponse>(`/portfolios/${id}`),
  create: (data: PortfolioRequest) =>
    apiFetch<PortfolioResponse>('/portfolios', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: PortfolioRequest) =>
    apiFetch<PortfolioResponse>(`/portfolios/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/portfolios/${id}`, { method: 'DELETE' }),

  addHolding: (portfolioId: string, data: HoldingRequest) =>
    apiFetch<HoldingResponse>(`/portfolios/${portfolioId}/holdings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateHolding: (portfolioId: string, holdingId: string, data: HoldingRequest) =>
    apiFetch<HoldingResponse>(`/portfolios/${portfolioId}/holdings/${holdingId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteHolding: (portfolioId: string, holdingId: string) =>
    apiFetch<void>(`/portfolios/${portfolioId}/holdings/${holdingId}`, { method: 'DELETE' }),

  listReports: (portfolioId: string) =>
    apiFetch<RiskReportSummary[]>(`/portfolios/${portfolioId}/reports`),

  getAnalytics: (id: string) => apiFetch<PortfolioAnalytics>(`/portfolios/${id}/analytics`),

  getInsights: (id: string) => apiFetch<PortfolioInsight>(`/portfolios/${id}/insights`),
};
