import { Decimal, type DecimalValue } from '@finsentinel/shared';
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
 *
 * Public shape uses `number` for backward compatibility with wallet
 * state sync in UnifiedTradingService (M3 will widen this to strings).
 * All arithmetic inside the engine uses `Decimal` — see M2 of
 * docs/exec-plans/2026-04-24-decimal-money-migration.md.
 */
export interface PositionMap {
  ticker: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
}

/**
 * Internal position structure — Decimal-backed.
 * Not exported; engine converts to/from `PositionMap` at the public boundary.
 */
interface DecimalPosition {
  ticker: string;
  shares: DecimalValue;
  avgCost: DecimalValue;
  currentPrice: DecimalValue;
}

/**
 * In-memory paper trading engine for simulated trading.
 *
 * NOT an Injectable — it is created by BrokerRegistry at runtime.
 *
 * Internal arithmetic runs on `Decimal` (precision 40, ROUND_HALF_EVEN) so
 * that repeated buys/sells do not accumulate IEEE-754 drift. Public method
 * signatures still accept / return `number` and `string` to preserve the
 * existing contract with UnifiedTradingService and the wallet schema —
 * widening those types is the M3 follow-up.
 *
 * Behavior:
 * - executeBuy: resolve qty from notional, check funds, weighted avg cost on existing positions
 * - executeSell: find position, resolve qty (sell all if null), calculate realized P&L
 */
export class PaperTradingEngine implements TradingEngine {
  private cash: DecimalValue;
  private readonly initialCash: DecimalValue;
  private realizedPnL: DecimalValue;
  private positions: DecimalPosition[];
  private orderHistory: OrderResult[];
  private orderSequence: number;

  constructor(
    private readonly marketDataService: MarketDataService,
    initialCash: number = 100000,
  ) {
    this.cash = new Decimal(initialCash);
    this.initialCash = new Decimal(initialCash);
    this.realizedPnL = new Decimal(0);
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

      // unrealizedPnL = (currentPrice - avgCost) * shares
      const unrealizedPnL = currentPrice.minus(pos.avgCost).times(pos.shares);

      enriched.push({
        symbol: pos.ticker,
        qty: pos.shares.toString(),
        avgCost: pos.avgCost.toString(),
        currentPrice: currentPrice.toString(),
        unrealizedPnL: unrealizedPnL.toString(),
        realizedPnL: this.realizedPnL.toString(),
      });
    }

    return enriched;
  }

  async getOrders(): Promise<OrderResult[]> {
    return [...this.orderHistory];
  }

  async getAccount(): Promise<AccountInfo> {
    let positionValue: DecimalValue = new Decimal(0);

    for (const pos of this.positions) {
      const currentPrice = await this.fetchCurrentPrice(pos.ticker);
      pos.currentPrice = currentPrice;
      // positionValue += shares * currentPrice
      positionValue = positionValue.plus(pos.shares.times(currentPrice));
    }

    const totalValue = this.cash.plus(positionValue);

    // Preserve existing public contract: AccountInfo.cashValue/totalValue/buyingPower
    // are typed as `number`. M3 will widen these to strings.
    return {
      totalValue: totalValue.toNumber(),
      cashValue: this.cash.toNumber(),
      buyingPower: this.cash.toNumber(),
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
    // Accepts number per existing contract; wrap so internal arithmetic
    // stays on Decimal. Numeric inputs from wallet strings (e.g. via
    // `Number(wallet.cashBalance)`) are safely re-wrapped here.
    this.cash = new Decimal(cash);
  }

  getCash(): number {
    return this.cash.toNumber();
  }

  setPositions(positions: PositionMap[]): void {
    this.positions = positions.map((p) => ({
      ticker: p.ticker,
      shares: new Decimal(p.shares),
      avgCost: new Decimal(p.avgCost),
      currentPrice: new Decimal(p.currentPrice),
    }));
  }

  /**
   * Returns a deep copy of the internal position maps.
   * Callers can mutate the returned array without affecting engine state.
   *
   * Public shape is `PositionMap[]` (number-typed) for backward compat;
   * internal storage is Decimal. M3 will widen the public shape to strings.
   */
  getPositionMaps(): PositionMap[] {
    return this.positions.map((p) => ({
      ticker: p.ticker,
      shares: p.shares.toNumber(),
      avgCost: p.avgCost.toNumber(),
      currentPrice: p.currentPrice.toNumber(),
    }));
  }

  setRealizedPnL(pnl: number): void {
    this.realizedPnL = new Decimal(pnl);
  }

  getRealizedPnL(): number {
    return this.realizedPnL.toNumber();
  }

  getInitialCash(): number {
    return this.initialCash.toNumber();
  }

  // ---------------------------------------------------------------------------
  // Buy execution
  // ---------------------------------------------------------------------------

  private async executeBuy(request: OrderRequest): Promise<OrderResult> {
    const price = await this.fetchCurrentPrice(request.symbol);
    let qty: DecimalValue;

    if (request.qty != null && request.qty !== '') {
      qty = new Decimal(request.qty);
    } else if (request.notional != null && request.notional !== '') {
      // qty = notional / price
      qty = new Decimal(request.notional).dividedBy(price);
    } else {
      const result = this.buildResult(false, '0', '0', 'Either qty or notional must be specified');
      this.orderHistory.push(result);
      return result;
    }

    // cost = qty * price
    const cost = qty.times(price);
    if (cost.greaterThan(this.cash)) {
      const result = this.buildResult(
        false,
        '0',
        '0',
        `Insufficient funds: need ${cost.toString()}, have ${this.cash.toString()}`,
      );
      this.orderHistory.push(result);
      return result;
    }

    // Deduct cash
    this.cash = this.cash.minus(cost);

    // Find existing position
    const existing = this.positions.find((p) => p.ticker === request.symbol);

    if (existing) {
      // Weighted average cost:
      //   newAvg = (oldShares*oldAvg + fillQty*fillPrice) / (oldShares + fillQty)
      const newShares = existing.shares.plus(qty);
      const newAvgCost = existing.shares
        .times(existing.avgCost)
        .plus(qty.times(price))
        .dividedBy(newShares);
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

    const result = this.buildResult(true, qty.toString(), price.toString(), null);
    this.orderHistory.push(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Sell execution
  // ---------------------------------------------------------------------------

  private async executeSell(request: OrderRequest): Promise<OrderResult> {
    const posIndex = this.positions.findIndex((p) => p.ticker === request.symbol);

    if (posIndex === -1) {
      const result = this.buildResult(false, '0', '0', `No position found for ${request.symbol}`);
      this.orderHistory.push(result);
      return result;
    }

    const position = this.positions[posIndex]!;
    const price = await this.fetchCurrentPrice(request.symbol);

    let qty: DecimalValue;
    if (request.qty != null && request.qty !== '') {
      qty = new Decimal(request.qty);
    } else {
      // Sell all
      qty = position.shares;
    }

    if (qty.greaterThan(position.shares)) {
      const result = this.buildResult(
        false,
        '0',
        '0',
        `Insufficient shares: want to sell ${qty.toString()}, have ${position.shares.toString()}`,
      );
      this.orderHistory.push(result);
      return result;
    }

    // Realized P&L = (price - avgCost) * qty
    const pnl = price.minus(position.avgCost).times(qty);
    this.realizedPnL = this.realizedPnL.plus(pnl);

    // Proceeds = qty * price
    const proceeds = qty.times(price);
    this.cash = this.cash.plus(proceeds);

    // Update or remove position
    if (qty.equals(position.shares)) {
      this.positions.splice(posIndex, 1);
    } else {
      position.shares = position.shares.minus(qty);
      position.currentPrice = price;
    }

    const result = this.buildResult(true, qty.toString(), price.toString(), null);
    this.orderHistory.push(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async fetchCurrentPrice(symbol: string): Promise<DecimalValue> {
    const quote = await this.marketDataService.getQuote(symbol);
    return new Decimal(quote.close);
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
