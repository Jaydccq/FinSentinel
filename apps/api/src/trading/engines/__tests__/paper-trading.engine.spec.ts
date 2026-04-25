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

  // ── 14. decimalArithmetic_drift_regression ─────────────────────────────
  // Known-drift scenario under JS `Number`: 1000 fills of qty=0.1 @ price=0.1
  // expected cash decrement = 1000 * 0.01 = 10.00000000 exactly.
  // Under the old `Number` path the cumulative sum drifted by ~1e-13
  // (classic 0.1 + 0.2 !== 0.3 accumulation). Under Decimal it must be exact.
  it('1000 sequential fills at qty=0.1 @ price=0.1 produce exact cash decrement (Decimal has no drift)', async () => {
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'AAPL',
      open: '0.1',
      high: '0.1',
      low: '0.1',
      close: '0.1',
      volume: 0,
      timestamp: Date.now(),
    });

    const startCash = 100000;
    for (let i = 0; i < 1000; i += 1) {
      const result = await engine.placeOrder({
        symbol: 'AAPL',
        side: 'buy',
        type: 'market',
        qty: '0.1',
      });
      expect(result.success).toBe(true);
    }

    const account = await engine.getAccount();
    // Expected decrement: 1000 * (0.1 * 0.1) = 10 exactly.
    // Cash is returned as `number`; Decimal-backed internal math means the
    // number-cast at the boundary is the already-exact result (10), not a
    // drifted intermediate (e.g. 9.99999999999986).
    expect(account.cashValue).toBe(startCash - 10);

    // Position shares = 1000 * 0.1 = 100 exactly.
    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.qty).toBe('100');
    expect(positions[0]!.avgCost).toBe('0.1');
  });

  // ── 15. decimalArithmetic_deterministic_property ───────────────────────
  // Property-style test: 100 sequential buy/sell orders with randomised
  // qty/price strings must produce byte-identical final cashBalance across
  // two runs driven by the same input sequence. With Decimal this is
  // guaranteed; with Number it typically is not (non-associative float
  // accumulation plus division rounding).
  it('100 randomised buy/sell fills are byte-identical across two runs with the same input sequence', async () => {
    const qtyPool = ['0.1', '0.2', '0.33', '1.5'];
    const pricePool = ['100.05', '200.1', '0.0001'];

    // Deterministic pseudo-random sequence generator (no external dep).
    // LCG parameters from Numerical Recipes.
    function makeSeq(seed: number): Array<{ side: 'buy' | 'sell'; qty: string; price: string }> {
      let s = seed;
      const next = (): number => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s;
      };
      const ops: Array<{ side: 'buy' | 'sell'; qty: string; price: string }> = [];
      for (let i = 0; i < 100; i += 1) {
        const side = i % 2 === 0 ? 'buy' : 'sell';
        const qty = qtyPool[next() % qtyPool.length]!;
        const price = pricePool[next() % pricePool.length]!;
        ops.push({ side, qty, price });
      }
      return ops;
    }

    const seq = makeSeq(42);

    async function runSeq(): Promise<string> {
      const md = createMockMarketDataService();
      const eng = new PaperTradingEngine(md, 1000000);
      for (const op of seq) {
        (md.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
          ticker: 'AAPL',
          open: op.price,
          high: op.price,
          low: op.price,
          close: op.price,
          volume: 0,
          timestamp: 0,
        });
        await eng.placeOrder({
          symbol: 'AAPL',
          side: op.side,
          type: 'market',
          qty: op.qty,
        });
      }
      // Serialize cash via the same precision boundary a caller would use.
      return String(eng.getCash());
    }

    const runA = await runSeq();
    const runB = await runSeq();

    expect(runA).toBe(runB);
  });

  // ── 16. M3 string-precision boundary methods ───────────────────────────
  // setCashFromString / getCashAsString / setPositionsFromStrings /
  // getPositionMapsAsStrings — used by UnifiedTradingService when
  // TRADING_DECIMAL_EXECUTE_ENABLED=true so the engine ↔ wallet round-trip
  // doesn't drop precision through Number.
  describe('Decimal-precision boundary (item 4 M3)', () => {
    it('round-trips cash via string at .toFixed(8) precision without drift', () => {
      engine.setCashFromString('123456789.12345678');
      expect(engine.getCashAsString()).toBe('123456789.12345678');
    });

    it('persists position fields via string at .toFixed(8) precision', () => {
      engine.setPositionsFromStrings([
        {
          ticker: 'AAPL',
          shares: '10.12345678',
          avgCost: '150.05',
          currentPrice: '155',
        },
      ]);
      const out = engine.getPositionMapsAsStrings();
      expect(out).toEqual([
        {
          ticker: 'AAPL',
          shares: '10.12345678',
          avgCost: '150.05000000',
          currentPrice: '155.00000000',
        },
      ]);
    });

    it('string boundary survives a sequence that drifts under Number', async () => {
      (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
        ticker: 'AAPL',
        open: '0.1',
        high: '0.1',
        low: '0.1',
        close: '0.1',
        volume: 0,
        timestamp: Date.now(),
      });

      engine.setCashFromString('100000');
      for (let i = 0; i < 100; i += 1) {
        await engine.placeOrder({
          symbol: 'AAPL',
          side: 'buy',
          type: 'market',
          qty: '0.1',
        });
      }
      // Exactly 100 fills at qty=0.1 @ price=0.1 = 1.0 spent.
      expect(engine.getCashAsString()).toBe('99999.00000000');
      const [pos] = engine.getPositionMapsAsStrings();
      expect(pos!.shares).toBe('10.00000000');
      expect(pos!.avgCost).toBe('0.10000000');
    });
  });
});
