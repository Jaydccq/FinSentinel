import { apiFetch } from './client'

export interface HoldingResponse {
  id: string
  symbol: string
  companyName: string
  quantity: number
  averageCost: number
  currentPrice: number | null
  sector: string
}

export interface PortfolioResponse {
  id: string
  name: string
  description: string
  totalValue: number
  holdings: HoldingResponse[]
  createdAt: string
}

export interface PortfolioRequest {
  name: string
  description?: string
}

export interface HoldingRequest {
  symbol: string
  companyName?: string
  quantity: number
  averageCost: number
  sector?: string
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
      method: 'POST', body: JSON.stringify(data),
    }),
  updateHolding: (portfolioId: string, holdingId: string, data: HoldingRequest) =>
    apiFetch<HoldingResponse>(`/portfolios/${portfolioId}/holdings/${holdingId}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteHolding: (portfolioId: string, holdingId: string) =>
    apiFetch<void>(`/portfolios/${portfolioId}/holdings/${holdingId}`, { method: 'DELETE' }),

  listReports: (portfolioId: string) =>
    apiFetch<any[]>(`/portfolios/${portfolioId}/reports`),
}
