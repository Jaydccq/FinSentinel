import {
  SecurityType,
  BrokerCapability,
  Contract,
} from '@finsentinel/shared';
import type { IBroker } from '../interfaces/broker';
import type { OkxTradingEngine } from '../../okx/okx-trading.engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../interfaces/types';

/**
 * OKX broker capabilities -- perpetual swaps and futures.
 */
const OKX_CAPABILITIES: Set<BrokerCapability> = new Set([
  BrokerCapability.PERPETUAL_SWAP,
  BrokerCapability.MARGIN_TRADING,
]);

/**
 * OkxBroker -- wraps OkxTradingEngine with Contract-aware symbol conversion.
 *
 * NOT an Injectable. Created by BrokerRegistry at runtime.
 *
 * OKX broker adapter:
 * - Supports PERP and FUTURE security types
 * - Converts contract to engine-native symbol via Contract.toEngineSymbol()
 * - Delegates all operations to the underlying OkxTradingEngine
 */
export class OkxBroker implements IBroker {
  constructor(private readonly _engine: OkxTradingEngine) {}

  // -- Identity ---------------------------------------------------------------

  brokerId(): string {
    return 'okx';
  }

  displayName(): string {
    return 'OKX (Crypto Derivatives)';
  }

  // -- Capability checks ------------------------------------------------------

  supportedSecurityTypes(): Set<SecurityType> {
    return new Set([SecurityType.PERP, SecurityType.FUTURE]);
  }

  capabilities(): Set<BrokerCapability> {
    return OKX_CAPABILITIES;
  }

  canHandle(contract: Contract): boolean {
    return (
      contract.secType === SecurityType.PERP ||
      contract.secType === SecurityType.FUTURE
    );
  }

  // -- Order execution --------------------------------------------------------

  async placeOrder(
    contract: Contract,
    request: OrderRequest,
  ): Promise<OrderResult> {
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
  engine(): OkxTradingEngine {
    return this._engine;
  }
}
