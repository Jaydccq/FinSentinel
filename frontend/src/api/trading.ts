import { apiFetch } from './client'

export interface TradeOperation {
  action: string
  ticker: string
  shares?: number
  amount?: number
  price?: number
}

export interface WalletPosition {
  ticker: string
  shares: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  pnlPercent: number
}

export interface WalletStatus {
  cashBalance: number
  initialCapital: number
  totalValue: number
  returnPercent: number
  tradingMode: string
  positions: WalletPosition[]
}

export interface TradeCommit {
  hash: string
  parentHash?: string
  message: string
  timestamp: string
  operations: TradeOperation[]
  results: Record<string, unknown>[]
}

export interface StagedOrders {
  operations: TradeOperation[]
  count: number
}

export interface MarketHours {
  isOpen: boolean
  nextOpen?: string
  nextClose?: string
  currentTime: string
}

export interface SimulateResult {
  ticker: string
  changePercent: number
  currentValue: number
  hypotheticalValue: number
  impact: number
}

export const tradingApi = {
  stage: (data: { action: string; ticker: string; shares?: number; amount?: number }) =>
    apiFetch<void>('/trading/stage', { method: 'POST', body: JSON.stringify(data) }),

  commit: (message: string) =>
    apiFetch<TradeCommit>('/trading/commit', { method: 'POST', body: JSON.stringify({ message }) }),

  execute: () =>
    apiFetch<TradeCommit>('/trading/execute', { method: 'POST' }),

  wallet: () =>
    apiFetch<WalletStatus>('/trading/wallet'),

  history: (limit = 10) =>
    apiFetch<TradeCommit[]>(`/trading/history?limit=${limit}`),

  staged: () =>
    apiFetch<StagedOrders>('/trading/staged'),

  simulate: (ticker: string, changePercent: number) =>
    apiFetch<SimulateResult>('/trading/simulate', {
      method: 'POST', body: JSON.stringify({ ticker, changePercent }),
    }),

  marketHours: () =>
    apiFetch<MarketHours>('/trading/market-hours'),

  switchMode: (mode: string) =>
    apiFetch<void>('/trading/mode', { method: 'PUT', body: JSON.stringify({ mode }) }),
}
