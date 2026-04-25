import { apiFetch } from './client';
import { routes } from './registry';
import { typedFetch } from './typed-client';
import type {
  HoldingResponse,
  PortfolioRequest,
  PortfolioResponse,
} from '@finsentinel/shared';
import type { RiskFactor } from './chat';

export type { HoldingResponse, PortfolioRequest, PortfolioResponse };

export interface RiskReportSummary {
  id: string;
  riskScore: number;
  riskLevel: string;
  summary: string;
  factors: RiskFactor[];
  actionableAdvice: string[];
  createdAt: string;
}

// Holding mutation DTO. The backend's holdingRequestSchema validates the
// numeric fields as decimal strings; existing call sites pass `Number(...)`
// values that JSON-serialise to numbers and the controller still accepts
// them today. The migration of holding routes is tracked as Phase 2 work
// in `docs/exec-plans/tech-debt-tracker.md`.
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

/**
 * Portfolio client. The CRUD surface (`list`, `get`, `create`, `update`,
 * `delete`) routes through `typedFetch` against the shared schema, so wire
 * drift on the most decimal-heavy surface raises `ResponseValidationError`
 * instead of silently coercing a string to NaN downstream.
 *
 * Holdings/analytics/insights/reports remain on raw `apiFetch` for now and
 * are tracked as follow-up migration in
 * `docs/exec-plans/tech-debt-tracker.md`.
 */
export const portfolioApi = {
  list: (): Promise<PortfolioResponse[]> => typedFetch({ ...routes.portfolio.list }),

  get: (id: string): Promise<PortfolioResponse> =>
    typedFetch({
      ...routes.portfolio.get,
      path: routes.portfolio.get.path.replace(':id', encodeURIComponent(id)),
    }),

  create: (data: PortfolioRequest): Promise<PortfolioResponse> =>
    typedFetch({ ...routes.portfolio.create, body: data }),

  update: (id: string, data: PortfolioRequest): Promise<PortfolioResponse> =>
    typedFetch({
      ...routes.portfolio.update,
      path: routes.portfolio.update.path.replace(':id', encodeURIComponent(id)),
      body: data,
    }),

  delete: (id: string): Promise<void> =>
    typedFetch({
      ...routes.portfolio.delete,
      path: routes.portfolio.delete.path.replace(':id', encodeURIComponent(id)),
    }) as Promise<void>,

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
