import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperTradingEngine } from '../paper-trading.engine';
import type { MarketDataService } from '../../../market/market-data.service';
import type { OrderRequest } from '../../interfaces/types';

// ── Mock MarketDataService ──────────────────────────────────────────────────
function createMockMarketDataService(): MarketDataService {
  return {
    getQuote: vi.fn().mockResolvedValue({
      ticker: 'AAPL',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      close: '150.00',
      volume: 50000000,
      timestamp: Date.now(),
    }),
    getHistoricalBars: vi.fn(),
    searchTickers: vi.fn(),
  } as unknown as MarketDataService;
}

describe('PaperTradingEngine', () => {
  let engine: PaperTradingEngine;
  let mockMarketData: MarketDataService;

  beforeEach(() => {
    mockMarketData = createMockMarketDataService();
    engine = new PaperTradingEngine(mockMarketData, 100000);
  });

  // ── 1. placeOrder_buyMarket_reducesCashAndAddsPosition ──────────────────
  it('buy market order reduces cash and adds position', async () => {
    // Mock AAPL at $150
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    const request: OrderRequest = {
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    };

    const result = await engine.placeOrder(request);

    expect(result.success).toBe(true);
    expect(result.status).toBe('filled');
    expect(Number(result.filledQty)).toBe(10);
    expect(Number(result.avgPrice)).toBe(150);

    const account = await engine.getAccount();
    // 100000 - (10 * 150) = 98500
    expect(account.cashValue).toBe(98500);

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.symbol).toBe('AAPL');
    expect(Number(positions[0]!.qty)).toBe(10);
  });

  // ── 2. placeOrder_sellWithPosition_increasesCash ────────────────────────
  it('sell with position increases cash and calculates P&L', async () => {
    // Setup: buy 10 AAPL @150
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    // Sell 5 AAPL @160
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '160.00',
      open: '160.00',
      high: '165.00',
      low: '159.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    const result = await engine.placeOrder({
      symbol: 'AAPL',
      side: 'sell',
      type: 'market',
      qty: '5',
    });

    expect(result.success).toBe(true);
    expect(Number(result.filledQty)).toBe(5);
    expect(Number(result.avgPrice)).toBe(160);

    const account = await engine.getAccount();
    // 100000 - 1500 + 800 = 99300
    // cash: 100000 - (10*150) = 98500 + (5*160) = 99300
    expect(account.cashValue).toBe(99300);

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(Number(positions[0]!.qty)).toBe(5);
    // Realized PnL = (160 - 150) * 5 = 50
    expect(Number(positions[0]!.realizedPnL)).toBe(50);
  });

  // ── 3. placeOrder_insufficientFunds_fails ───────────────────────────────
  it('buy order with insufficient funds fails', async () => {
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    const result = await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '1000', // 1000 * 150 = 150000 > 100000
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Insufficient funds');
  });

  // ── 4. engineName_returnsPaper ──────────────────────────────────────────
  it('engineName returns "paper"', () => {
    expect(engine.engineName()).toBe('paper');
  });

  // ── 5. placeOrder_sellAll_removesPosition ───────────────────────────────
  it('selling all shares removes position', async () => {
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    // Sell all
    const result = await engine.placeOrder({
      symbol: 'AAPL',
      side: 'sell',
      type: 'market',
      qty: '10',
    });

    expect(result.success).toBe(true);

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(0);
  });

  // ── 6. placeOrder_sellNoPosition_fails ──────────────────────────────────
  it('sell with no position fails', async () => {
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    const result = await engine.placeOrder({
      symbol: 'AAPL',
      side: 'sell',
      type: 'market',
      qty: '5',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('No position');
  });

  // ── 7. placeOrder_buyWithNotional_calculatesShares ──────────────────────
  it('buy with notional calculates shares from dollar amount', async () => {
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    const result = await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      notional: '1500', // 1500 / 150 = 10 shares
    });

    expect(result.success).toBe(true);
    expect(Number(result.filledQty)).toBe(10);
    expect(Number(result.avgPrice)).toBe(150);

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(Number(positions[0]!.qty)).toBe(10);
  });

  // ── 8. getAccount_reflectsCorrectValues ─────────────────────────────────
  it('getAccount reflects correct total value', async () => {
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    // Now price goes to 160
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '160.00',
      open: '160.00',
      high: '165.00',
      low: '159.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    const account = await engine.getAccount();
    // cash: 100000 - 1500 = 98500
    // positions: 10 * 160 = 1600
    // total: 98500 + 1600 = 100100
    expect(account.cashValue).toBe(98500);
    expect(account.totalValue).toBe(100100);
    expect(account.buyingPower).toBe(98500);
  });

  // ── 9. cancelOrder_alwaysReturnsFalse ───────────────────────────────────
  it('cancelOrder always returns false', async () => {
    const result = await engine.cancelOrder('any-order-id');
    expect(result).toBe(false);
  });

  // ── 10. getOrders_tracksOrderHistory ────────────────────────────────────
  it('getOrders tracks order history', async () => {
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'sell',
      type: 'market',
      qty: '5',
    });

    const orders = await engine.getOrders();
    expect(orders).toHaveLength(2);
    expect(orders[0]!.success).toBe(true);
    expect(orders[1]!.success).toBe(true);
  });

  // ── 11. setCashAndSetPositions_restoreWalletState ───────────────────────
  it('setCash and setPositions restore wallet state', async () => {
    engine.setCash(50000);
    engine.setPositions([{ ticker: 'AAPL', shares: 20, avgCost: 145, currentPrice: 150 }]);

    // Mock for getAccount → getPositions price lookup
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    const account = await engine.getAccount();
    // cash: 50000, positions: 20 * 150 = 3000, total = 53000
    expect(account.cashValue).toBe(50000);
    expect(account.totalValue).toBe(53000);

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(Number(positions[0]!.qty)).toBe(20);
    expect(Number(positions[0]!.avgCost)).toBe(145);
  });

  // ── 12. getPositionMaps_returnsDeepCopy ─────────────────────────────────
  it('getPositionMaps returns a deep copy', () => {
    engine.setPositions([{ ticker: 'AAPL', shares: 10, avgCost: 150, currentPrice: 155 }]);

    const copy1 = engine.getPositionMaps();
    const copy2 = engine.getPositionMaps();

    // Should be equal but not the same reference
    expect(copy1).toEqual(copy2);
    expect(copy1).not.toBe(copy2);
    expect(copy1[0]).not.toBe(copy2[0]);
  });

  // ── 13. placeOrder_buyThenBuy_calculatesWeightedAvgCost ─────────────────
  it('buy then buy calculates weighted average cost', async () => {
    // First buy: 10 shares @ $150
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '150.00',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    // Second buy: 10 shares @ $160
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      close: '160.00',
      open: '160.00',
      high: '165.00',
      low: '159.00',
      volume: 50000000,
      timestamp: Date.now(),
    });

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(Number(positions[0]!.qty)).toBe(20);
    // Weighted avg: (10 * 150 + 10 * 160) / 20 = 3100 / 20 = 155
    expect(Number(positions[0]!.avgCost)).toBe(155);
  });
});
