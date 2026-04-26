import { apiFetch } from './client';
import { routes } from './registry';
import { typedFetch } from './typed-client';
import type {
  OrderLedgerListResponse,
  OrderLedgerRowResponse,
  AcknowledgeLedgerRequest,
} from '@finsentinel/shared';

export interface TradeOperation {
  action: string;
  ticker: string;
  shares?: number;
  amount?: number;
  price?: number;
}

export interface WalletStatus {
  cashBalance: string;
  initialCapital: string;
  totalValue: string;
  returnPercent: string;
  tradingMode: string;
  positions: Array<Record<string, unknown>>;
}

export interface TradeCommit {
  message: string;
}

export type StagedOrders = TradeOperation[];

export interface TradeHistoryResponse {
  history: string;
}

export const tradingApi = {
  stage: (data: { action: string; ticker: string; shares?: number; amount?: number }) =>
    apiFetch<void>('/trading/stage', { method: 'POST', body: JSON.stringify(data) }),

  commit: (message: string) =>
    apiFetch<TradeCommit>('/trading/commit', { method: 'POST', body: JSON.stringify({ message }) }),

  execute: () => apiFetch<TradeCommit>('/trading/execute', { method: 'POST' }),

  wallet: () => apiFetch<WalletStatus>('/trading/wallet'),

  history: (limit = 10) => apiFetch<TradeHistoryResponse>(`/trading/history?limit=${limit}`),

  staged: () => apiFetch<StagedOrders>('/trading/staged'),

  switchMode: (mode: string) =>
    apiFetch<void>('/trading/mode', { method: 'PUT', body: JSON.stringify({ mode }) }),
};

/* ─── V2 Unified Trading Account (UTA) API ─── */

export interface V2TradeOperation {
  action: string;
  symbol: string;
  qty?: string;
  amount?: string;
  price?: string;
}

export interface V2WalletPosition {
  symbol: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  pnlPercent: number;
  securityType?: string;
}

export interface V2WalletStatus {
  cashBalance: number;
  initialCapital: number;
  totalValue: number;
  returnPercent: number;
  tradingMode: string;
  positions: V2WalletPosition[];
}

export interface V2TradeCommit {
  hash: string;
  parentHash?: string;
  message: string;
  timestamp: string;
  operations: V2TradeOperation[];
  results: Record<string, unknown>[];
  metadata?: { ledgerId?: string; runId?: string };
}

export interface V2StagedOrders {
  operations: V2TradeOperation[];
  count: number;
}

export interface AssetSearchResult {
  symbol: string;
  name?: string;
  securityType?: string;
  exchange?: string;
}

export const tradingApiV2 = {
  stage: (data: {
    action: string;
    symbol: string;
    qty?: string;
    amount?: string;
    price?: string;
  }) => apiFetch<void>('/trading/v2/stage', { method: 'POST', body: JSON.stringify(data) }),

  commit: (message: string) =>
    apiFetch<V2TradeCommit>('/trading/v2/commit', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  execute: () => apiFetch<V2TradeCommit>('/trading/v2/execute', { method: 'POST' }),

  wallet: () => apiFetch<V2WalletStatus>('/trading/v2/wallet'),

  history: (limit = 10) => apiFetch<V2TradeCommit[]>(`/trading/v2/history?limit=${limit}`),

  staged: () => apiFetch<V2StagedOrders>('/trading/v2/staged'),

  search: (query: string) =>
    apiFetch<AssetSearchResult[]>(`/trading/v2/search?query=${encodeURIComponent(query)}`),
};

/* ─── Order Ledger (read-only — phase 1 trading-status UI) ─── */

/**
 * Routes through the typed registry so the response is Zod-validated at
 * runtime — silent JSON drift surfaces as `ResponseValidationError`
 * instead of poisoning the SWR cache.
 */
export const tradingLedgerApi = {
  list: (limit = 25): Promise<OrderLedgerListResponse> =>
    typedFetch({
      ...routes.trading.ledger,
      query: { limit },
    }),
  /**
   * UNKNOWN_REQUIRES_OPERATOR_REVIEW rows that need operator attention.
   * Powers the Acknowledge flow's confirmation list and the ack-pending
   * SWR cache invalidation.
   */
  unknown: (): Promise<OrderLedgerListResponse> =>
    typedFetch({ ...routes.trading.ledgerUnknown }),
  /**
   * Operator acknowledgement. Substitutes `:id` into the path before the
   * fetch — the typed registry leaves the placeholder in place because
   * route descriptors are static.
   */
  acknowledge: (
    id: string,
    body: AcknowledgeLedgerRequest,
  ): Promise<OrderLedgerRowResponse> =>
    typedFetch({
      ...routes.trading.ledgerAcknowledge,
      path: routes.trading.ledgerAcknowledge.path.replace(
        ':id',
        encodeURIComponent(id),
      ),
      body,
    }),
};
