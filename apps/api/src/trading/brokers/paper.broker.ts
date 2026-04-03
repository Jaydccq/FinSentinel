import {
  SecurityType,
  BrokerCapability,
  isCrypto,
  Contract,
} from '@finsentinel/shared';
import type { IBroker } from '../interfaces/broker';
import type { PaperTradingEngine } from '../engines/paper-trading.engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../interfaces/types';

/**
 * All SecurityType values as a Set.
 * Paper broker supports every instrument type.
 */
const ALL_SECURITY_TYPES: Set<SecurityType> = new Set([
  SecurityType.STOCK,
  SecurityType.OPTION,
  SecurityType.FUTURE,
  SecurityType.CRYPTO,
  SecurityType.PERP,
  SecurityType.FOREX,
]);

/**
 * PaperBroker capabilities — spot trading and market data only.
 */
const PAPER_CAPABILITIES: Set<BrokerCapability> = new Set([
  BrokerCapability.SPOT_TRADING,
  BrokerCapability.MARKET_DATA,
]);

/**
 * PaperBroker — wraps PaperTradingEngine with Contract-aware symbol conversion.
 *
 * NOT an Injectable. Created by BrokerRegistry at runtime.
 *
 * Paper broker adapter:
 * - Converts crypto/perp contracts to Polygon format: "X:{symbol}{currency}"
 * - Delegates all operations to the underlying PaperTradingEngine
 */
export class PaperBroker implements IBroker {
  constructor(private readonly _engine: PaperTradingEngine) {}

  // ── Identity ────────────────────────────────────────────────────────────

  brokerId(): string {
    return 'paper';
  }

  displayName(): string {
    return 'Paper Trading (Simulated)';
  }

  // ── Capability checks ──────────────────────────────────────────────────

  supportedSecurityTypes(): Set<SecurityType> {
    return ALL_SECURITY_TYPES;
  }

  capabilities(): Set<BrokerCapability> {
    return PAPER_CAPABILITIES;
  }

  canHandle(contract: Contract): boolean {
    return this.supportedSecurityTypes().has(contract.secType);
  }

  // ── Order execution ────────────────────────────────────────────────────

  async placeOrder(
    contract: Contract,
    request: OrderRequest,
  ): Promise<OrderResult> {
    // Convert contract to Polygon-native symbol for crypto: "X:{symbol}{currency}"
    const nativeSymbol = isCrypto(contract.secType)
      ? `X:${contract.symbol}${contract.currency}`
      : contract.symbol;

    const adapted: OrderRequest = {
      ...request,
      symbol: nativeSymbol,
    };

    return this._engine.placeOrder(adapted);
  }

  // ── Delegated operations ───────────────────────────────────────────────

  async getPositions(): Promise<PositionInfo[]> {
    return this._engine.getPositions();
  }

  async getOrders(): Promise<OrderResult[]> {
    return this._engine.getOrders();
  }

  async getAccount(): Promise<AccountInfo> {
    return this._engine.getAccount();
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return this._engine.cancelOrder(orderId);
  }

  async syncOrders(): Promise<OrderResult[]> {
    return this._engine.syncOrders();
  }

  async getMarketClock(): Promise<MarketClock> {
    return this._engine.getMarketClock();
  }

  async searchContracts(_query: string): Promise<Contract[]> {
    return [];
  }

  // ── Engine access ──────────────────────────────────────────────────────

  /** Expose the underlying engine for wallet state management. */
  engine(): PaperTradingEngine {
    return this._engine;
  }
}
