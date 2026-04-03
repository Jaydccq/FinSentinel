import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from './types';

/**
 * Contract for trading engines (Paper, Alpaca, OKX, etc.).
 *
 * Each engine handles order placement, position tracking, and account info
 * for a specific broker or simulation mode.
 *
 * Shared contract implemented by all trading engines.
 */
export interface TradingEngine {
  /** Place a buy or sell order. */
  placeOrder(request: OrderRequest): Promise<OrderResult>;

  /** Get all current positions enriched with live market prices. */
  getPositions(): Promise<PositionInfo[]>;

  /** Get order history. */
  getOrders(): Promise<OrderResult[]>;

  /** Get account summary (cash, total value, buying power). */
  getAccount(): Promise<AccountInfo>;

  /** Cancel an order by ID. Returns true if cancelled, false otherwise. */
  cancelOrder(orderId: string): Promise<boolean>;

  /** Unique engine identifier, e.g. "paper", "alpaca", "okx". */
  engineName(): string;

  /**
   * Sync orders with the broker.
   * Default implementation returns getOrders() (no-op sync).
   */
  syncOrders?(): Promise<OrderResult[]>;

  /**
   * Get market clock info.
   * Default: always open.
   */
  getMarketClock?(): Promise<MarketClock>;
}
