/**
 * Trading engine type definitions.
 *
 * These are internal types (not API-facing), so we use plain interfaces
 * instead of Zod schemas. Financial values use `number` for in-memory
 * calculations; precision-critical values are strings only at the DB/API layer.
 */

// ── OrderRequest ────────────────────────────────────────────────────────────

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  qty?: string;
  notional?: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: string;
  reduceOnly?: boolean;
}

// ── OrderResult ─────────────────────────────────────────────────────────────

export interface OrderResult {
  success: boolean;
  orderId: string;
  status: string;
  filledQty: string;
  avgPrice: string;
  errorMessage: string | null;
  timestamp: string; // ISO-8601
}

// ── PositionInfo ────────────────────────────────────────────────────────────

export interface PositionInfo {
  symbol: string;
  qty: string;
  avgCost: string;
  currentPrice: string;
  unrealizedPnL: string;
  realizedPnL: string;
}

// ── AccountInfo ─────────────────────────────────────────────────────────────

export interface AccountInfo {
  totalValue: number;
  cashValue: number;
  buyingPower: number;
}

// ── MarketClock ─────────────────────────────────────────────────────────────

export interface MarketClock {
  isOpen: boolean;
  nextOpen: string | null; // ISO-8601
  nextClose: string | null; // ISO-8601
  timestamp: string; // ISO-8601
}
