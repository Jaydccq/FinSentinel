import { apiFetch } from './client'

export interface QuoteData {
  ticker: string
  close: number
  open: number
  high: number
  low: number
  volume: number
  timestamp: number
}

export const marketApi = {
  quote: (ticker: string) => apiFetch<QuoteData>(`/market/quote/${ticker}`),
  batchQuotes: (tickers: string[]) =>
    apiFetch<Record<string, QuoteData>>(`/market/batch-quotes`, {
      method: 'POST',
      body: JSON.stringify(tickers),
    }),
  history: (ticker: string, days = 30) =>
    apiFetch<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>>(
      `/market/history/${ticker}?days=${days}`
    ),
}
