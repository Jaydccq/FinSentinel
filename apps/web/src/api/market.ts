import { apiFetch } from './client';

export interface QuoteData {
  ticker: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

export interface TickerSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  assetType: string; // EQUITY, CRYPTOCURRENCY, ETF, MUTUALFUND
}

interface RawQuoteData {
  ticker: string;
  close: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  volume: number;
  timestamp: number;
}

interface RawHistoryBar {
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number;
  timestamp: number;
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function normalizeQuoteData(raw: RawQuoteData): QuoteData {
  return {
    ticker: raw.ticker,
    close: toNumber(raw.close),
    open: toNumber(raw.open),
    high: toNumber(raw.high),
    low: toNumber(raw.low),
    volume: raw.volume,
    timestamp: raw.timestamp,
  };
}

export const marketApi = {
  quote: async (ticker: string) =>
    normalizeQuoteData(await apiFetch<RawQuoteData>(`/market/quote/${ticker}`)),
  batchQuotes: (tickers: string[]) =>
    apiFetch<Record<string, RawQuoteData>>(`/market/batch-quotes`, {
      method: 'POST',
      body: JSON.stringify(tickers),
    }).then((data) =>
      Object.fromEntries(
        Object.entries(data).map(([symbol, quote]) => [symbol, normalizeQuoteData(quote)]),
      ),
    ),
  history: async (ticker: string, days = 30) =>
    (await apiFetch<RawHistoryBar[]>(`/market/history/${ticker}?days=${days}`)).map((bar) => ({
      t: bar.timestamp,
      o: toNumber(bar.open),
      h: toNumber(bar.high),
      l: toNumber(bar.low),
      c: toNumber(bar.close),
      v: bar.volume,
    })),
  search: (query: string, limit = 8) =>
    apiFetch<TickerSearchResult[]>(`/market/search?q=${encodeURIComponent(query)}&limit=${limit}`),
};
