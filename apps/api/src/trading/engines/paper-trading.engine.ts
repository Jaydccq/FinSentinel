import type { MarketDataService } from '../../market/market-data.service';
import type { TradingEngine } from '../interfaces/trading-engine';
import type {
  OrderRequest,
  OrderResult,
  PositionInfo,
  AccountInfo,
  MarketClock,
} from '../interfaces/types';

/**
 * Internal position map structure used by PaperTradingEngine.
 */
export interface PositionMap {
  ticker: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
}

/**
 * In-memory paper trading engine for simulated trading.
 *
 * NOT an Injectable — it is created by BrokerRegistry at runtime.
 * Uses `number` for all financial calculations (mirrors Java BigDecimal.doubleValue()).
 *
 * Matches Java PaperTradingEngine logic exactly:
 * - executeBuy: resolve qty from notional, check funds, weighted avg cost on existing positions
 * - executeSell: find position, resolve qty (sell all if null), calculate realized P&L
 */
export class PaperTradingEngine implements TradingEngine {
  private cash: number;
  private readonly initialCash: number;
  private realizedPnL: number;
  private positions: PositionMap[];
  private orderHistory: OrderResult[];
  private orderSequence: number;

  constructor(
    private readonly marketDataService: MarketDataService,
    initialCash: number = 100000,
  ) {
    this.cash = initialCash;
    this.initialCash = initialCash;
    this.realizedPnL = 0;
    this.positions = [];
    this.orderHistory = [];
    this.orderSequence = 0;
  }

  // ---------------------------------------------------------------------------
  // TradingEngine interface
  // ---------------------------------------------------------------------------

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    try {
      if (request.side === 'buy') {
        return await this.executeBuy(request);
      } else {
        return await this.executeSell(request);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const result = this.buildResult(false, '0', '0', errorMessage);
      this.orderHistory.push(result);
      return result;
    }
  }

  async getPositions(): Promise<PositionInfo[]> {
    const enriched: PositionInfo[] = [];

    for (const pos of this.positions) {
      const currentPrice = await this.fetchCurrentPrice(pos.ticker);
      pos.currentPrice = currentPrice;

      const unrealizedPnL = (currentPrice - pos.avgCost) * pos.shares;

      enriched.push({
        symbol: pos.ticker,
        qty: String(pos.shares),
        avgCost: String(pos.avgCost),
        currentPrice: String(currentPrice),
        unrealizedPnL: String(unrealizedPnL),
        realizedPnL: String(this.realizedPnL),
      });
    }

    return enriched;
  }

  async getOrders(): Promise<OrderResult[]> {
    return [...this.orderHistory];
  }

  async getAccount(): Promise<AccountInfo> {
    let positionValue = 0;

    for (const pos of this.positions) {
      const currentPrice = await this.fetchCurrentPrice(pos.ticker);
      pos.currentPrice = currentPrice;
      positionValue += pos.shares * currentPrice;
    }

    const totalValue = this.cash + positionValue;

    return {
      totalValue,
      cashValue: this.cash,
      buyingPower: this.cash,
    };
  }

  async cancelOrder(_orderId: string): Promise<boolean> {
    // Paper trading does not support order cancellation
    return false;
  }

  engineName(): string {
    return 'paper';
  }

  async syncOrders(): Promise<OrderResult[]> {
    return this.getOrders();
  }

  async getMarketClock(): Promise<MarketClock> {
    return {
      isOpen: true,
      nextOpen: null,
      nextClose: null,
      timestamp: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // State management (used by BrokerRegistry / wallet restore)
  // ---------------------------------------------------------------------------

  setCash(cash: number): void {
    this.cash = cash;
  }

  getCash(): number {
    return this.cash;
  }

  setPositions(positions: PositionMap[]): void {
    this.positions = positions.map((p) => ({ ...p }));
  }

  /**
   * Returns a deep copy of the internal position maps.
   * Callers can mutate the returned array without affecting engine state.
   */
  getPositionMaps(): PositionMap[] {
    return this.positions.map((p) => ({ ...p }));
  }

  setRealizedPnL(pnl: number): void {
    this.realizedPnL = pnl;
  }

  getRealizedPnL(): number {
    return this.realizedPnL;
  }

  getInitialCash(): number {
    return this.initialCash;
  }

  // ---------------------------------------------------------------------------
  // Buy execution
  // ---------------------------------------------------------------------------

  private async executeBuy(request: OrderRequest): Promise<OrderResult> {
    const price = await this.fetchCurrentPrice(request.symbol);
    let qty: number;

    if (request.qty != null && request.qty !== '') {
      qty = Number(request.qty);
    } else if (request.notional != null && request.notional !== '') {
      qty = Number(request.notional) / price;
    } else {
      const result = this.buildResult(
        false,
        '0',
        '0',
        'Either qty or notional must be specified',
      );
      this.orderHistory.push(result);
      return result;
    }

    const cost = qty * price;
    if (cost > this.cash) {
      const result = this.buildResult(
        false,
        '0',
        '0',
        `Insufficient funds: need ${cost}, have ${this.cash}`,
      );
      this.orderHistory.push(result);
      return result;
    }

    // Deduct cash
    this.cash -= cost;

    // Find existing position
    const existing = this.positions.find(
      (p) => p.ticker === request.symbol,
    );

    if (existing) {
      // Weighted average cost
      const newShares = existing.shares + qty;
      const newAvgCost =
        (existing.shares * existing.avgCost + qty * price) / newShares;
      existing.shares = newShares;
      existing.avgCost = newAvgCost;
      existing.currentPrice = price;
    } else {
      this.positions.push({
        ticker: request.symbol,
        shares: qty,
        avgCost: price,
        currentPrice: price,
      });
    }

    const result = this.buildResult(true, String(qty), String(price), null);
    this.orderHistory.push(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Sell execution
  // ---------------------------------------------------------------------------

  private async executeSell(request: OrderRequest): Promise<OrderResult> {
    const posIndex = this.positions.findIndex(
      (p) => p.ticker === request.symbol,
    );

    if (posIndex === -1) {
      const result = this.buildResult(
        false,
        '0',
        '0',
        `No position found for ${request.symbol}`,
      );
      this.orderHistory.push(result);
      return result;
    }

    const position = this.positions[posIndex]!;
    const price = await this.fetchCurrentPrice(request.symbol);

    let qty: number;
    if (request.qty != null && request.qty !== '') {
      qty = Number(request.qty);
    } else {
      // Sell all
      qty = position.shares;
    }

    if (qty > position.shares) {
      const result = this.buildResult(
        false,
        '0',
        '0',
        `Insufficient shares: want to sell ${qty}, have ${position.shares}`,
      );
      this.orderHistory.push(result);
      return result;
    }

    // Calculate realized P&L
    const pnl = (price - position.avgCost) * qty;
    this.realizedPnL += pnl;

    // Add proceeds to cash
    this.cash += qty * price;

    // Update or remove position
    if (qty === position.shares) {
      this.positions.splice(posIndex, 1);
    } else {
      position.shares -= qty;
      position.currentPrice = price;
    }

    const result = this.buildResult(true, String(qty), String(price), null);
    this.orderHistory.push(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async fetchCurrentPrice(symbol: string): Promise<number> {
    const quote = await this.marketDataService.getQuote(symbol);
    return Number(quote.close);
  }

  private buildResult(
    success: boolean,
    filledQty: string,
    avgPrice: string,
    errorMessage: string | null,
  ): OrderResult {
    this.orderSequence += 1;
    return {
      success,
      orderId: `paper-${this.orderSequence}`,
      status: success ? 'filled' : 'rejected',
      filledQty,
      avgPrice,
      errorMessage,
      timestamp: new Date().toISOString(),
    };
  }
}
