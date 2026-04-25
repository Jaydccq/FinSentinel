import { SecurityType, BrokerCapability, Contract } from '@finsentinel/shared';
import type { IBroker } from '../interfaces/broker';
import type { CcxtTradingEngine } from '../engines/ccxt-trading.engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../interfaces/types';

/**
 * CCXT broker capabilities — spot trading only (crypto exchanges).
 */
const CCXT_CAPABILITIES: Set<BrokerCapability> = new Set([BrokerCapability.SPOT_TRADING]);

/**
 * CcxtBroker — wraps CcxtTradingEngine with Contract-aware symbol conversion.
 *
 * NOT an Injectable. Created by BrokerRegistry at runtime.
 *
 * CCXT broker adapter:
 * - Supports CRYPTO security type only
 * - Converts contract to CCXT-native symbol via Contract.toEngineSymbol()
 *   (e.g., BTC → BTC/USDT using contract.currency)
 * - Delegates all operations to the underlying CcxtTradingEngine
 */
export class CcxtBroker implements IBroker {
  constructor(private readonly _engine: CcxtTradingEngine) {}

  // -- Identity ---------------------------------------------------------------

  brokerId(): string {
    return 'ccxt';
  }

  displayName(): string {
    return 'CCXT (Crypto)';
  }

  // -- Capability checks ------------------------------------------------------

  supportedSecurityTypes(): Set<SecurityType> {
    return new Set([SecurityType.CRYPTO]);
  }

  capabilities(): Set<BrokerCapability> {
    return CCXT_CAPABILITIES;
  }

  canHandle(contract: Contract): boolean {
    return contract.secType === SecurityType.CRYPTO;
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
  engine(): CcxtTradingEngine {
    return this._engine;
  }
}
