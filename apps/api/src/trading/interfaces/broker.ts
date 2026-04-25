import type { SecurityType, BrokerCapability } from '@finsentinel/shared';
import type { Contract } from '@finsentinel/shared';
import type { OrderRequest, OrderResult, PositionInfo, AccountInfo, MarketClock } from './types';

/**
 * Contract-aware broker abstraction.
 *
 * Contract-aware broker abstraction used by the unified trading layer.
 * Each broker adapter (Paper, Alpaca, OKX, CCXT) implements this interface.
 *
 * Key difference from TradingEngine: IBroker is Contract-aware and converts
 * contracts to broker-native symbol formats before delegating to the engine.
 */
export interface IBroker {
  /** Unique broker identifier, e.g. "paper", "alpaca", "okx". */
  brokerId(): string;

  /** Human-readable name for display. */
  displayName(): string;

  /** Set of security types this broker can trade. */
  supportedSecurityTypes(): Set<SecurityType>;

  /** Set of capabilities this broker supports. */
  capabilities(): Set<BrokerCapability>;

  /**
   * Check if this broker can handle a given contract.
   * Default logic: checks if the contract's secType is in supportedSecurityTypes().
   */
  canHandle(contract: Contract): boolean;

  /** Place an order for the given contract. */
  placeOrder(contract: Contract, request: OrderRequest): Promise<OrderResult>;

  /** Get all current positions. */
  getPositions(): Promise<PositionInfo[]>;

  /** Get order history. */
  getOrders(): Promise<OrderResult[]>;

  /** Get account summary. */
  getAccount(): Promise<AccountInfo>;

  /** Cancel an order by ID. Returns true if cancelled. */
  cancelOrder(orderId: string): Promise<boolean>;

  /** Sync orders with the broker. Default: returns getOrders(). */
  syncOrders(): Promise<OrderResult[]>;

  /** Get market clock info. Default: always open. */
  getMarketClock(): Promise<MarketClock>;

  /** Search for contracts matching a query. Default: empty array. */
  searchContracts(query: string): Promise<Contract[]>;

  /**
   * OPTIONAL — query the broker for ground-truth status of an order by its
   * broker-side id. Used by the M3 LedgerReconcilerService to resolve rows
   * stuck in EXECUTING after a process crash mid-broker-call.
   *
   * Brokers that don't expose an order-status endpoint (e.g., paper) leave
   * this undefined; the reconciler treats absence as 'unknown' and parks
   * the row in UNKNOWN_REQUIRES_OPERATOR_REVIEW.
   *
   * Returns:
   *   - 'filled'   — order completed; reconciler transitions row → EXECUTED.
   *   - 'rejected' — order failed at the broker; reconciler → FAILED.
   *   - 'pending'  — broker still working; reconciler bumps updated_at and
   *                  re-polls on the next tick.
   *   - 'unknown'  — broker can't find the id (e.g., 404); reconciler →
   *                  UNKNOWN_REQUIRES_OPERATOR_REVIEW.
   */
  queryOrderStatus?(brokerOrderId: string): Promise<{
    status: 'filled' | 'rejected' | 'pending' | 'unknown';
    filledQty?: string;
    avgPrice?: string;
    errorReason?: string;
  }>;
}
