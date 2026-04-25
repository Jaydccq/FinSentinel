import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CcxtTradingEngine,
  type CcxtExchange,
  type CcxtOrder,
  type CcxtBalance,
  type CcxtPosition,
} from '../ccxt-trading.engine';
import type { OrderRequest } from '../../interfaces/types';

// ── Mock exchange factory ───────────────────────────────────────────────────
function createMockExchange(): CcxtExchange {
  return {
    createOrder: vi.fn(),
    fetchBalance: vi.fn(),
    fetchPositions: vi.fn(),
    fetchOrders: vi.fn(),
    fetchOpenOrders: vi.fn(),
    cancelOrder: vi.fn(),
  };
}

describe('CcxtTradingEngine', () => {
  let engine: CcxtTradingEngine;
  let mockExchange: CcxtExchange;

  beforeEach(() => {
    mockExchange = createMockExchange();
    engine = new CcxtTradingEngine(mockExchange);
  });

  // ── 1. engineName_returnsCcxt ─────────────────────────────────────────────
  it('engineName returns "ccxt"', () => {
    expect(engine.engineName()).toBe('ccxt');
  });

  // ── 2. placeOrder_marketOrder_delegatesToExchange ─────────────────────────
  it('placeOrder delegates a market order to exchange.createOrder', async () => {
    const ccxtOrder: CcxtOrder = {
      id: 'order-001',
      symbol: 'BTC/USDT',
      side: 'buy',
      status: 'closed',
      average: 42000.5,
      filled: 0.5,
      datetime: '2026-03-31T10:00:00Z',
    };
    vi.mocked(mockExchange.createOrder).mockResolvedValue(ccxtOrder);

    const request: OrderRequest = {
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'market',
      qty: '0.5',
    };

    const result = await engine.placeOrder(request);

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-001');
    expect(result.symbol).toBe('BTC/USDT');
    expect(result.side).toBe('buy');
    expect(result.status).toBe('filled'); // "closed" -> "filled"
    expect(result.filledQty).toBe('0.5');
    expect(result.avgPrice).toBe('42000.5');
    expect(result.errorMessage).toBeNull();
    expect(result.timestamp).toBe('2026-03-31T10:00:00Z');

    expect(mockExchange.createOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      'market',
      'buy',
      0.5,
      undefined,
    );
  });

  // ── 3. placeOrder_limitOrder_passesPriceToExchange ────────────────────────
  it('placeOrder passes price to exchange for limit orders', async () => {
    const ccxtOrder: CcxtOrder = {
      id: 'order-002',
      symbol: 'ETH/USDT',
      side: 'sell',
      status: 'open',
      average: null,
      filled: 0,
      datetime: '2026-03-31T10:00:00Z',
    };
    vi.mocked(mockExchange.createOrder).mockResolvedValue(ccxtOrder);

    const request: OrderRequest = {
      symbol: 'ETH/USDT',
      side: 'sell',
      type: 'limit',
      qty: '2',
      price: '3500.00',
    };

    await engine.placeOrder(request);

    expect(mockExchange.createOrder).toHaveBeenCalledWith('ETH/USDT', 'limit', 'sell', 2, 3500);
  });

  // ── 4. placeOrder_exchangeError_returnsRejectedResult ────────────────────
  it('placeOrder returns rejected result when exchange throws', async () => {
    vi.mocked(mockExchange.createOrder).mockRejectedValue(new Error('Insufficient balance'));

    const request: OrderRequest = {
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'market',
      qty: '100',
    };

    const result = await engine.placeOrder(request);

    expect(result.success).toBe(false);
    expect(result.orderId).toBe('');
    expect(result.status).toBe('rejected');
    expect(result.filledQty).toBe('0');
    expect(result.errorMessage).toBe('Insufficient balance');
  });

  // ── 5. placeOrder_mapsOrderStatuses ───────────────────────────────────────
  it('maps CCXT order statuses correctly', async () => {
    const statuses = [
      { input: 'closed', expected: 'filled' },
      { input: 'canceled', expected: 'cancelled' },
      { input: 'rejected', expected: 'rejected' },
      { input: 'expired', expected: 'rejected' },
      { input: 'open', expected: 'pending' },
    ];

    for (const { input, expected } of statuses) {
      vi.mocked(mockExchange.createOrder).mockResolvedValueOnce({
        id: `order-${input}`,
        status: input,
        average: 0,
        filled: 0,
        datetime: null,
      });

      const result = await engine.placeOrder({
        symbol: 'BTC/USDT',
        side: 'buy',
        type: 'market',
        qty: '1',
      });

      expect(result.status).toBe(expected);
    }
  });

  // ── 6. placeOrder_usesNotionalWhenQtyMissing ──────────────────────────────
  it('placeOrder uses notional as amount when qty is not provided', async () => {
    vi.mocked(mockExchange.createOrder).mockResolvedValue({
      id: 'order-notional',
      status: 'closed',
      average: 42000,
      filled: 1,
      datetime: null,
    });

    await engine.placeOrder({
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'market',
      notional: '1000',
    });

    expect(mockExchange.createOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      'market',
      'buy',
      1000,
      undefined,
    );
  });

  // ── 7. placeOrder_fallsBackToPriceWhenAverageIsNull ───────────────────────
  it('placeOrder uses price field when average is null', async () => {
    vi.mocked(mockExchange.createOrder).mockResolvedValue({
      id: 'order-price-fallback',
      status: 'closed',
      price: 3200.5,
      average: null,
      filled: 1,
      datetime: null,
    });

    const result = await engine.placeOrder({
      symbol: 'ETH/USDT',
      side: 'buy',
      type: 'market',
      qty: '1',
    });

    expect(result.avgPrice).toBe('3200.5');
  });

  // ── 8. getPositions_mapsExchangePositions ─────────────────────────────────
  it('getPositions maps exchange positions to PositionInfo array', async () => {
    const ccxtPositions: CcxtPosition[] = [
      {
        symbol: 'BTC/USDT',
        side: 'long',
        contracts: 2,
        entryPrice: 41000,
        markPrice: 42000,
        notional: 84000,
        unrealizedPnl: 2000,
      },
      {
        symbol: 'ETH/USDT',
        side: 'short',
        contracts: 10,
        entryPrice: 3500,
        markPrice: 3400,
        notional: 34000,
        unrealizedPnl: 1000,
      },
    ];
    vi.mocked(mockExchange.fetchPositions).mockResolvedValue(ccxtPositions);

    const positions = await engine.getPositions();

    expect(positions).toHaveLength(2);
    expect(positions[0]).toEqual({
      symbol: 'BTC/USDT',
      side: 'long',
      qty: '2',
      avgEntryPrice: '41000',
      avgCost: '41000',
      currentPrice: '42000',
      marketValue: '84000',
      unrealizedPnL: '2000',
    });
    expect(positions[1]).toEqual({
      symbol: 'ETH/USDT',
      side: 'short',
      qty: '10',
      avgEntryPrice: '3500',
      avgCost: '3500',
      currentPrice: '3400',
      marketValue: '34000',
      unrealizedPnL: '1000',
    });
  });

  // ── 9. getPositions_exchangeError_returnsEmptyArray ───────────────────────
  it('getPositions returns empty array on exchange error', async () => {
    vi.mocked(mockExchange.fetchPositions).mockRejectedValue(new Error('Exchange unavailable'));

    const positions = await engine.getPositions();
    expect(positions).toEqual([]);
  });

  // ── 10. getOrders_mapsExchangeOrders ──────────────────────────────────────
  it('getOrders maps exchange orders to OrderResult array', async () => {
    const ccxtOrders: CcxtOrder[] = [
      {
        id: 'order-100',
        symbol: 'BTC/USDT',
        side: 'buy',
        status: 'closed',
        average: 42000,
        filled: 0.5,
        datetime: '2026-03-31T09:00:00Z',
      },
      {
        id: 'order-101',
        symbol: 'ETH/USDT',
        side: 'sell',
        status: 'canceled',
        average: null,
        filled: 0,
        datetime: '2026-03-31T10:00:00Z',
      },
    ];
    vi.mocked(mockExchange.fetchOrders).mockResolvedValue(ccxtOrders);

    const orders = await engine.getOrders();

    expect(orders).toHaveLength(2);
    expect(orders[0]).toEqual(
      expect.objectContaining({
        success: true,
        orderId: 'order-100',
        symbol: 'BTC/USDT',
        side: 'buy',
        status: 'filled',
        filledQty: '0.5',
        avgPrice: '42000',
      }),
    );
    expect(orders[1]).toEqual(
      expect.objectContaining({
        success: true,
        orderId: 'order-101',
        status: 'cancelled',
        filledQty: '0',
      }),
    );

    // Verify fetchOrders called with limit
    expect(mockExchange.fetchOrders).toHaveBeenCalledWith(undefined, undefined, 50);
  });

  // ── 11. getOrders_exchangeError_returnsEmptyArray ─────────────────────────
  it('getOrders returns empty array on exchange error', async () => {
    vi.mocked(mockExchange.fetchOrders).mockRejectedValue(new Error('Timeout'));

    const orders = await engine.getOrders();
    expect(orders).toEqual([]);
  });

  // ── 12. syncOrders_fetchesOpenOrdersOnly ──────────────────────────────────
  it('syncOrders fetches open orders only', async () => {
    const openOrders: CcxtOrder[] = [
      {
        id: 'order-open-1',
        symbol: 'BTC/USDT',
        side: 'buy',
        status: 'open',
        average: null,
        filled: 0,
        datetime: '2026-03-31T12:00:00Z',
      },
    ];
    vi.mocked(mockExchange.fetchOpenOrders).mockResolvedValue(openOrders);

    const orders = await engine.syncOrders!();

    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe('pending'); // "open" -> "pending"
    expect(mockExchange.fetchOpenOrders).toHaveBeenCalledWith(undefined, undefined, 50);
  });

  // ── 13. syncOrders_exchangeError_returnsEmptyArray ────────────────────────
  it('syncOrders returns empty array on exchange error', async () => {
    vi.mocked(mockExchange.fetchOpenOrders).mockRejectedValue(new Error('Rate limited'));

    const orders = await engine.syncOrders!();
    expect(orders).toEqual([]);
  });

  // ── 14. getMarketClock_alwaysOpen ─────────────────────────────────────────
  it('getMarketClock returns always-open clock for crypto', async () => {
    const clock = await engine.getMarketClock!();

    expect(clock.isOpen).toBe(true);
    expect(clock.nextOpen).toBeNull();
    expect(clock.nextClose).toBeNull();
    expect(clock.timestamp).toBeDefined();
  });

  // ── 15. getAccount_mapsBalanceToAccountInfo ───────────────────────────────
  it('getAccount maps USDT balance to AccountInfo', async () => {
    const balance: CcxtBalance = {
      total: { USDT: 50000, BTC: 0.5 },
      free: { USDT: 30000, BTC: 0.5 },
      used: { USDT: 20000, BTC: 0 },
    };
    vi.mocked(mockExchange.fetchBalance).mockResolvedValue(balance);

    const account = await engine.getAccount();

    expect(account.totalValue).toBe(50000);
    expect(account.cashValue).toBe(30000);
    expect(account.buyingPower).toBe(30000);
    expect(account.cash).toBe('30000');
    expect(account.portfolioValue).toBe('50000');
    expect(account.equity).toBe('50000');
  });

  // ── 16. getAccount_fallsBackToUsdWhenNoUsdt ───────────────────────────────
  it('getAccount falls back to USD when USDT is not present', async () => {
    const balance: CcxtBalance = {
      total: { USD: 10000 },
      free: { USD: 8000 },
      used: { USD: 2000 },
    };
    vi.mocked(mockExchange.fetchBalance).mockResolvedValue(balance);

    const account = await engine.getAccount();

    expect(account.totalValue).toBe(10000);
    expect(account.cashValue).toBe(8000);
  });

  // ── 17. getAccount_exchangeError_returnsZeroValues ────────────────────────
  it('getAccount returns zero values on exchange error', async () => {
    vi.mocked(mockExchange.fetchBalance).mockRejectedValue(new Error('Auth failed'));

    const account = await engine.getAccount();

    expect(account.totalValue).toBe(0);
    expect(account.cashValue).toBe(0);
    expect(account.buyingPower).toBe(0);
  });

  // ── 18. cancelOrder_delegatesToExchange_returnsTrue ───────────────────────
  it('cancelOrder delegates to exchange and returns true on success', async () => {
    vi.mocked(mockExchange.cancelOrder).mockResolvedValue({
      id: 'order-cancel',
      status: 'canceled',
    });

    const result = await engine.cancelOrder('order-cancel');

    expect(result).toBe(true);
    expect(mockExchange.cancelOrder).toHaveBeenCalledWith('order-cancel');
  });

  // ── 19. cancelOrder_exchangeError_returnsFalse ────────────────────────────
  it('cancelOrder returns false on exchange error', async () => {
    vi.mocked(mockExchange.cancelOrder).mockRejectedValue(new Error('Order not found'));

    const result = await engine.cancelOrder('nonexistent');
    expect(result).toBe(false);
  });

  // ── 20. getPositions_handlesNullFields ────────────────────────────────────
  it('getPositions handles null/undefined fields gracefully', async () => {
    const ccxtPositions: CcxtPosition[] = [
      {
        symbol: 'SOL/USDT',
        // side, contracts, entryPrice, markPrice, notional, unrealizedPnl all undefined
      },
    ];
    vi.mocked(mockExchange.fetchPositions).mockResolvedValue(ccxtPositions);

    const positions = await engine.getPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({
      symbol: 'SOL/USDT',
      side: undefined,
      qty: '0',
      avgEntryPrice: undefined,
      avgCost: '0',
      currentPrice: '0',
      marketValue: undefined,
      unrealizedPnL: '0',
    });
  });

  // ── 21. placeOrder_networkError_returnsRejected ───────────────────────────
  it('placeOrder handles non-Error throws gracefully', async () => {
    vi.mocked(mockExchange.createOrder).mockRejectedValue('string error');

    const result = await engine.placeOrder({
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'market',
      qty: '1',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.errorMessage).toBe('string error');
  });
});
