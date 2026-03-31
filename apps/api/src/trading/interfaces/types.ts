/**
 * Trading engine type definitions.
 *
 * These mirror the Java records in
 * com.example.finsentinel.service.trading.engine.*
 *
 * Internal types (not API-facing), so we use plain interfaces.
 * Financial values use `string` for precision-safe serialization;
 * numeric conversions happen at the application layer.
 *
 * Fields marked optional (?) are available only from certain engines
 * (e.g. Alpaca provides `symbol`/`side` on OrderResult, paper doesn't).
 */

// ── OrderRequest ────────────────────────────────────────────────────────────

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  qty?: string;
  notional?: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: string; // "day", "gtc", "ioc", "fok"
  reduceOnly?: boolean;
}

// ── OrderResult ─────────────────────────────────────────────────────────────

export interface OrderResult {
  success: boolean;
  orderId: string;
  symbol?: string;
  side?: 'buy' | 'sell';
  status: string; // "filled", "pending", "cancelled", "rejected"
  filledPrice?: string;
  filledQty: string;
  avgPrice?: string;
  errorMessage: string | null;
  timestamp: string; // ISO-8601
}

// ── PositionInfo ────────────────────────────────────────────────────────────

export interface PositionInfo {
  symbol: string;
  side?: 'long' | 'short';
  qty: string;
  avgEntryPrice?: string;
  avgCost: string;
  currentPrice: string;
  marketValue?: string;
  unrealizedPnL: string;
  costBasis?: string;
  realizedPnL?: string;
}

// ── AccountInfo ─────────────────────────────────────────────────────────────

export interface AccountInfo {
  totalValue: number;
  cashValue: number;
  buyingPower: number;
  cash?: string;
  portfolioValue?: string;
  equity?: string;
  unrealizedPnL?: string;
  realizedPnL?: string;
}

// ── MarketClock ─────────────────────────────────────────────────────────────

export interface MarketClock {
  isOpen: boolean;
  nextOpen: string | null; // ISO-8601
  nextClose: string | null; // ISO-8601
  timestamp: string; // ISO-8601
}
