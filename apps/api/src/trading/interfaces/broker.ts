import type { SecurityType, BrokerCapability } from '@finsentinel/shared';
import type { Contract } from '@finsentinel/shared';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from './types';

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
}
