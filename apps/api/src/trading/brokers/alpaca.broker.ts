import { SecurityType, BrokerCapability, Contract } from '@finsentinel/shared';
import type { IBroker } from '../interfaces/broker';
import type { AlpacaTradingEngine } from '../engines/alpaca-trading.engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../interfaces/types';

/**
 * Alpaca broker capabilities — spot trading only (US equities).
 */
const ALPACA_CAPABILITIES: Set<BrokerCapability> = new Set([BrokerCapability.SPOT_TRADING]);

/**
 * AlpacaBroker — wraps AlpacaTradingEngine with Contract-aware symbol conversion.
 *
 * NOT an Injectable. Created by BrokerRegistry at runtime.
 *
 * Alpaca broker adapter:
 * - Supports STOCK security type only
 * - Converts contract to engine-native symbol via Contract.toEngineSymbol()
 * - Delegates all operations to the underlying AlpacaTradingEngine
 */
export class AlpacaBroker implements IBroker {
  constructor(private readonly _engine: AlpacaTradingEngine) {}

  // -- Identity ---------------------------------------------------------------

  brokerId(): string {
    return 'alpaca';
  }

  displayName(): string {
    return 'Alpaca (US Equities)';
  }

  // -- Capability checks ------------------------------------------------------

  supportedSecurityTypes(): Set<SecurityType> {
    return new Set([SecurityType.STOCK]);
  }

  capabilities(): Set<BrokerCapability> {
    return ALPACA_CAPABILITIES;
  }

  canHandle(contract: Contract): boolean {
    return contract.secType === SecurityType.STOCK;
  }

  // -- Order execution --------------------------------------------------------

  async placeOrder(contract: Contract, request: OrderRequest): Promise<OrderResult> {
    const adapted: OrderRequest = {
      ...request,
      symbol: contract.toEngineSymbol(),
    };

    return this._engine.placeOrder(adapted);
  }

  // -- Delegated operations ---------------------------------------------------

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
    return this._engine.syncOrders!();
  }

  async getMarketClock(): Promise<MarketClock> {
    return this._engine.getMarketClock!();
  }

  async searchContracts(_query: string): Promise<Contract[]> {
    return [];
  }

  // -- Engine access ----------------------------------------------------------

  /** Expose the underlying engine for direct access when needed. */
  engine(): AlpacaTradingEngine {
    return this._engine;
  }
}
