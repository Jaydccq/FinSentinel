import type { TradingEngine } from '../interfaces/trading-engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../interfaces/types';

// ── Minimal CCXT exchange interface (DI-friendly, no ccxt import) ────────────

/**
 * Subset of the ccxt Exchange API surface that CcxtTradingEngine needs.
 *
 * Accepting this interface instead of the real `ccxt.Exchange` class keeps
 * the engine fully testable with plain mocks — no ccxt dependency at test time.
 */
export interface CcxtExchange {
  createOrder(
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price?: number,
  ): Promise<CcxtOrder>;

  fetchBalance(): Promise<CcxtBalance>;

  fetchPositions(symbols?: string[]): Promise<CcxtPosition[]>;

  fetchOrders(
    symbol?: string,
    since?: number,
    limit?: number,
  ): Promise<CcxtOrder[]>;

  fetchOpenOrders(
    symbol?: string,
    since?: number,
    limit?: number,
  ): Promise<CcxtOrder[]>;

  cancelOrder(id: string, symbol?: string): Promise<CcxtOrder>;
}

// ── CCXT response shapes (minimal subset) ───────────────────────────────────

export interface CcxtOrder {
  id: string;
  symbol?: string;
  side?: string;
  status?: string; // "open", "closed", "canceled"
  price?: number | null;
  average?: number | null;
  amount?: number;
  filled?: number;
  datetime?: string | null;
}

export interface CcxtBalance {
  total: Record<string, number | undefined>;
  free: Record<string, number | undefined>;
  used: Record<string, number | undefined>;
}

export interface CcxtPosition {
  symbol?: string;
  side?: string;
  contracts?: number;
  contractSize?: number;
  entryPrice?: number;
  markPrice?: number;
  notional?: number;
  unrealizedPnl?: number;
}

// ── CcxtTradingEngine ───────────────────────────────────────────────────────

/**
 * CCXT trading engine for 100+ crypto exchanges.
 *
 * Wraps a `CcxtExchange` instance (injected via constructor) to provide
 * the standard `TradingEngine` interface.
 *
 * NOT an Injectable — instantiated by BrokerRegistry at runtime.
 *
 * Mirrors the Java CcxtTradingEngine exactly.
 */
export class CcxtTradingEngine implements TradingEngine {
  constructor(private readonly exchange: CcxtExchange) {}

  // ---------------------------------------------------------------------------
  // TradingEngine interface
  // ---------------------------------------------------------------------------

  engineName(): string {
    return 'ccxt';
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    try {
      const amount = Number(request.qty ?? request.notional ?? '0');
      const price =
        request.price != null ? Number(request.price) : undefined;

      const order = await this.exchange.createOrder(
        request.symbol,
        request.type,
        request.side,
        amount,
        price,
      );

      return this.mapOrderResult(order);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      return {
        success: false,
        orderId: '',
        status: 'rejected',
        filledQty: '0',
        avgPrice: '0',
        errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getPositions(): Promise<PositionInfo[]> {
    try {
      const positions = await this.exchange.fetchPositions();

      return positions.map((pos) => ({
        symbol: pos.symbol ?? '',
        side: this.mapPositionSide(pos.side),
        qty: String(pos.contracts ?? 0),
        avgEntryPrice: pos.entryPrice != null ? String(pos.entryPrice) : undefined,
        avgCost: String(pos.entryPrice ?? 0),
        currentPrice: String(pos.markPrice ?? 0),
        marketValue: pos.notional != null ? String(pos.notional) : undefined,
        unrealizedPnL: String(pos.unrealizedPnl ?? 0),
      }));
    } catch (err: unknown) {
      return [];
    }
  }

  async getOrders(): Promise<OrderResult[]> {
    try {
      const orders = await this.exchange.fetchOrders(undefined, undefined, 50);
      return orders.map((order) => this.mapOrderResult(order));
    } catch (err: unknown) {
      return [];
    }
  }

  async syncOrders(): Promise<OrderResult[]> {
    try {
      const orders = await this.exchange.fetchOpenOrders(
        undefined,
        undefined,
        50,
      );
      return orders.map((order) => this.mapOrderResult(order));
    } catch (err: unknown) {
      return [];
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    // Crypto markets are always open
    return {
      isOpen: true,
      nextOpen: null,
      nextClose: null,
      timestamp: new Date().toISOString(),
    };
  }

  async getAccount(): Promise<AccountInfo> {
    try {
      const balance = await this.exchange.fetchBalance();

      const totalUsd = balance.total['USDT'] ?? balance.total['USD'] ?? 0;
      const freeUsd = balance.free['USDT'] ?? balance.free['USD'] ?? 0;

      return {
        totalValue: totalUsd,
        cashValue: freeUsd,
        buyingPower: freeUsd,
        cash: String(freeUsd),
        portfolioValue: String(totalUsd),
        equity: String(totalUsd),
      };
    } catch (err: unknown) {
      return {
        totalValue: 0,
        cashValue: 0,
        buyingPower: 0,
      };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.exchange.cancelOrder(orderId);
      return true;
    } catch (err: unknown) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapOrderResult(order: CcxtOrder): OrderResult {
    const avgPrice =
      order.average != null
        ? String(order.average)
        : order.price != null
          ? String(order.price)
          : '0';
    const filledQty = order.filled != null ? String(order.filled) : '0';

    return {
      success: true,
      orderId: order.id,
      symbol: order.symbol,
      side: order.side as 'buy' | 'sell' | undefined,
      status: this.mapOrderStatus(order.status ?? ''),
      filledPrice: avgPrice,
      filledQty,
      avgPrice,
      errorMessage: null,
      timestamp: order.datetime ?? new Date().toISOString(),
    };
  }

  /**
   * Maps CCXT order status strings to standardized FinSentinel status values.
   *
   * - "closed" -> "filled"
   * - "canceled" -> "cancelled"
   * - "rejected" | "expired" -> "rejected"
   * - everything else (including "open") -> "pending"
   */
  private mapOrderStatus(ccxtStatus: string): string {
    switch (ccxtStatus) {
      case 'closed':
        return 'filled';
      case 'canceled':
        return 'cancelled';
      case 'rejected':
      case 'expired':
        return 'rejected';
      default:
        return 'pending';
    }
  }

  private mapPositionSide(
    side?: string,
  ): 'long' | 'short' | undefined {
    if (side === 'long' || side === 'short') return side;
    return undefined;
  }
}
