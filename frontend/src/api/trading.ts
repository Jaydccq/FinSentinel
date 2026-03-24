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

/* ─── V2 Unified Trading Account (UTA) API ─── */

export interface V2TradeOperation {
  action: string
  symbol: string
  qty?: string
  amount?: string
  price?: string
}

export interface V2WalletPosition {
  symbol: string
  qty: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  pnlPercent: number
  securityType?: string
}

export interface V2WalletStatus {
  cashBalance: number
  initialCapital: number
  totalValue: number
  returnPercent: number
  tradingMode: string
  positions: V2WalletPosition[]
}

export interface V2TradeCommit {
  hash: string
  parentHash?: string
  message: string
  timestamp: string
  operations: V2TradeOperation[]
  results: Record<string, unknown>[]
}

export interface V2StagedOrders {
  operations: V2TradeOperation[]
  count: number
}

export interface AssetSearchResult {
  symbol: string
  name?: string
  securityType?: string
  exchange?: string
}

export const tradingApiV2 = {
  stage: (data: { action: string; symbol: string; qty?: string; amount?: string; price?: string }) =>
    apiFetch<void>('/trading/v2/stage', { method: 'POST', body: JSON.stringify(data) }),

  commit: (message: string) =>
    apiFetch<V2TradeCommit>('/trading/v2/commit', { method: 'POST', body: JSON.stringify({ message }) }),

  execute: () =>
    apiFetch<V2TradeCommit>('/trading/v2/execute', { method: 'POST' }),

  wallet: () =>
    apiFetch<V2WalletStatus>('/trading/v2/wallet'),

  history: (limit = 10) =>
    apiFetch<V2TradeCommit[]>(`/trading/v2/history?limit=${limit}`),

  staged: () =>
    apiFetch<V2StagedOrders>('/trading/v2/staged'),

  search: (query: string) =>
    apiFetch<AssetSearchResult[]>(`/trading/v2/search?q=${encodeURIComponent(query)}`),
}
