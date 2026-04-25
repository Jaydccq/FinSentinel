import type { TradingEngine } from '../interfaces/trading-engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../interfaces/types';

/**
 * Alpaca Markets trading engine for US equities.
 *
 * Communicates with the Alpaca REST API v2 using native `fetch()`.
 * NOT an Injectable -- instantiated by BrokerRegistry at runtime.
 *
 * Default base URL targets the Alpaca paper-trading sandbox.
 *
 * Implements the Alpaca-backed trading engine.
 */
export class AlpacaTradingEngine implements TradingEngine {
  private static readonly DEFAULT_BASE_URL = 'https://paper-api.alpaca.markets';

  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    baseUrl?: string,
  ) {
    this.baseUrl = baseUrl ?? AlpacaTradingEngine.DEFAULT_BASE_URL;
  }

  // ---------------------------------------------------------------------------
  // TradingEngine interface
  // ---------------------------------------------------------------------------

  engineName(): string {
    return 'alpaca';
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    try {
      const body = this.buildOrderBody(request);
      const response = await this.sendPost('/v2/orders', body);
      const node = await response.json();

      return this.parseOrderNode(node);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
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
      const response = await this.sendGet('/v2/positions');
      const array = (await response.json()) as Record<string, string>[];

      return array.map((node) => ({
        symbol: node['symbol']!,
        side: node['side'] as 'long' | 'short',
        qty: node['qty']!,
        avgEntryPrice: node['avg_entry_price'],
        avgCost: node['avg_entry_price']!,
        currentPrice: node['current_price']!,
        marketValue: node['market_value'],
        unrealizedPnL: node['unrealized_pl']!,
        costBasis: node['cost_basis'],
      }));
    } catch (err: unknown) {
      // Return an empty result set on fetch failure.
      return [];
    }
  }

  async getOrders(): Promise<OrderResult[]> {
    try {
      const response = await this.sendGet('/v2/orders?status=all&limit=50');
      const array = (await response.json()) as Record<string, unknown>[];

      return array.map((node) => this.parseOrderNode(node));
    } catch (err: unknown) {
      return [];
    }
  }

  async syncOrders(): Promise<OrderResult[]> {
    try {
      const response = await this.sendGet('/v2/orders?status=open&limit=50');
      const array = (await response.json()) as Record<string, unknown>[];

      return array.map((node) => this.parseOrderNode(node));
    } catch (err: unknown) {
      return [];
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    try {
      const response = await this.sendGet('/v2/clock');
      const node = (await response.json()) as Record<string, unknown>;

      return {
        isOpen: node['is_open'] as boolean,
        nextOpen: node['next_open'] as string,
        nextClose: node['next_close'] as string,
        timestamp: node['timestamp'] as string,
      };
    } catch (err: unknown) {
      return {
        isOpen: false,
        nextOpen: null,
        nextClose: null,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getAccount(): Promise<AccountInfo> {
    try {
      const response = await this.sendGet('/v2/account');
      const node = (await response.json()) as Record<string, string>;

      const cash = node['cash'] ?? '0';
      const portfolioValue = node['portfolio_value'] ?? '0';
      const equity = node['equity'] ?? '0';
      const buyingPower = node['buying_power'] ?? '0';
      const unrealizedPnL = node['unrealized_pl'] ?? '0';
      const realizedPnL = node['realized_pl'] ?? '0';

      return {
        totalValue: Number(portfolioValue),
        cashValue: Number(cash),
        buyingPower: Number(buyingPower),
        cash,
        portfolioValue,
        equity,
        unrealizedPnL,
        realizedPnL,
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
      await this.sendDelete(`/v2/orders/${orderId}`);
      return true;
    } catch (err: unknown) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Order parsing
  // ---------------------------------------------------------------------------

  private parseOrderNode(node: Record<string, unknown>): OrderResult {
    const filledAvgPrice =
      node['filled_avg_price'] != null ? String(node['filled_avg_price']) : '0';
    const filledQty = node['filled_qty'] != null ? String(node['filled_qty']) : '0';
    const filledAt = node['filled_at'] != null ? String(node['filled_at']) : undefined;

    return {
      success: true,
      orderId: String(node['id'] ?? ''),
      symbol: node['symbol'] as string | undefined,
      side: node['side'] as 'buy' | 'sell' | undefined,
      status: this.mapOrderStatus(String(node['status'] ?? '')),
      filledPrice: filledAvgPrice,
      filledQty,
      avgPrice: filledAvgPrice,
      errorMessage: null,
      timestamp: filledAt ?? new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private authHeaders(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey,
    };
  }

  private async sendGet(path: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    this.checkStatus(response);
    return response;
  }

  private async sendPost(path: string, body: Record<string, unknown>): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    this.checkStatus(response);
    return response;
  }

  private async sendDelete(path: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    this.checkStatus(response);
    return response;
  }

  private checkStatus(response: Response): void {
    if (!response.ok) {
      throw new Error(`Alpaca API error ${response.status}: ${response.statusText}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the JSON body for the Alpaca POST /v2/orders endpoint.
   */
  private buildOrderBody(req: OrderRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      time_in_force: req.timeInForce ?? 'day',
    };

    if (req.qty != null) {
      body['qty'] = req.qty;
    }
    if (req.notional != null) {
      body['notional'] = req.notional;
    }
    if (req.price != null) {
      body['limit_price'] = req.price;
    }
    if (req.stopPrice != null) {
      body['stop_price'] = req.stopPrice;
    }

    return body;
  }

  /**
   * Maps Alpaca order status strings to standardized FinSentinel status values.
   *
   * - "filled" -> "filled"
   * - "canceled" -> "cancelled"
   * - "rejected" | "expired" -> "rejected"
   * - everything else -> "pending"
   */
  private mapOrderStatus(alpacaStatus: string): string {
    switch (alpacaStatus) {
      case 'filled':
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
}
