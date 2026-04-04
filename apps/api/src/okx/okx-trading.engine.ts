import type { TradingEngine } from '../trading/interfaces/trading-engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../trading/interfaces/types';
import type { OkxApiClient } from './okx-api.client';

/**
 * OKX trading engine -- implements TradingEngine for crypto derivatives.
 *
 * Wraps OkxApiClient, maps OKX API responses to internal FinSentinel types.
 * NOT an Injectable -- instantiated by OkxModule at runtime.
 *
 * Implements the OKX-backed trading engine.
 */
export class OkxTradingEngine implements TradingEngine {
  constructor(private readonly client: OkxApiClient) {}

  engineName(): string {
    return 'okx';
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    try {
      const result = await this.client.placeOrder({
        instId: request.symbol,
        tdMode: 'cross',
        side: request.side,
        ordType: this.mapOrderType(request.type),
        sz: request.qty ?? '0',
        px: request.type === 'limit' || request.type === 'stop_limit'
          ? request.price
          : undefined,
        reduceOnly: request.reduceOnly,
      });

      if (!result) {
        return this.errorResult('OKX returned null response');
      }

      return {
        success: true,
        orderId: result.ordId ?? '',
        symbol: result.instId,
        side: result.side as 'buy' | 'sell' | undefined,
        status: this.mapOrderStatus(result.state ?? 'live'),
        filledPrice: result.fillPx || result.avgPx || '0',
        filledQty: result.fillSz || '0',
        avgPrice: result.avgPx || '0',
        errorMessage: null,
        timestamp: result.cTime
          ? new Date(Number(result.cTime)).toISOString()
          : new Date().toISOString(),
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      return this.errorResult(errorMessage);
    }
  }

  async getPositions(): Promise<PositionInfo[]> {
    try {
      const positions = await this.client.getPositions();

      return positions.map((pos) => ({
        symbol: pos.instId,
        side: this.mapPosSide(pos.posSide),
        qty: pos.pos,
        avgEntryPrice: pos.avgPx,
        avgCost: pos.avgPx,
        currentPrice: pos.markPx,
        marketValue: pos.notionalUsd,
        unrealizedPnL: pos.upl,
      }));
    } catch (err: unknown) {
      return [];
    }
  }

  async getOrders(): Promise<OrderResult[]> {
    try {
      const orders = await this.client.getPendingOrders();
      return orders.map((ord) => ({
        success: true,
        orderId: ord.ordId,
        symbol: ord.instId,
        side: ord.side as 'buy' | 'sell',
        status: this.mapOrderStatus(ord.state),
        filledPrice: ord.fillPx || ord.avgPx || '0',
        filledQty: ord.fillSz || '0',
        avgPrice: ord.avgPx || '0',
        errorMessage: null,
        timestamp: ord.cTime
          ? new Date(Number(ord.cTime)).toISOString()
          : new Date().toISOString(),
      }));
    } catch (err: unknown) {
      return [];
    }
  }

  async getAccount(): Promise<AccountInfo> {
    try {
      const balance = await this.client.getAccountBalance();

      if (!balance) {
        return { totalValue: 0, cashValue: 0, buyingPower: 0 };
      }

      const totalEq = Number(balance.totalEq) || 0;
      const availableBalance = balance.details?.[0]?.availBal;
      const cashValue = availableBalance ? Number(availableBalance) : totalEq;

      return {
        totalValue: totalEq,
        cashValue,
        buyingPower: cashValue,
        equity: balance.totalEq,
        unrealizedPnL: balance.details?.[0]?.upl ?? '0',
      };
    } catch (err: unknown) {
      return { totalValue: 0, cashValue: 0, buyingPower: 0 };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    // OKX cancel-order requires instId + ordId. Since we only have orderId here,
    // we pass a blank instId. Callers should use the full cancelOrder on the client
    // when they have both values.
    try {
      return await this.client.cancelOrder('', orderId);
    } catch (err: unknown) {
      return false;
    }
  }

  async syncOrders(): Promise<OrderResult[]> {
    return this.getOrders();
  }

  async getMarketClock(): Promise<MarketClock> {
    // Crypto markets are always open (24/7).
    return {
      isOpen: true,
      nextOpen: null,
      nextClose: null,
      timestamp: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapOrderType(type: string): string {
    switch (type) {
      case 'market':
        return 'market';
      case 'limit':
      case 'stop_limit':
        return 'limit';
      case 'stop':
        return 'market';
      default:
        return 'market';
    }
  }

  private mapOrderStatus(okxState: string): string {
    switch (okxState) {
      case 'filled':
        return 'filled';
      case 'canceled':
        return 'cancelled';
      case 'live':
      case 'partially_filled':
        return 'pending';
      default:
        return 'pending';
    }
  }

  private mapPosSide(posSide: string): 'long' | 'short' {
    if (posSide === 'short') return 'short';
    return 'long'; // "long" or "net" → long
  }

  private errorResult(errorMessage: string): OrderResult {
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
