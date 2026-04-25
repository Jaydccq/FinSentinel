import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AlpacaTradingEngine } from '../alpaca-trading.engine';
import type { OrderRequest } from '../../interfaces/types';

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();

describe('AlpacaTradingEngine', () => {
  let engine: AlpacaTradingEngine;

  const TEST_API_KEY = 'test-api-key';
  const TEST_SECRET_KEY = 'test-secret-key';
  const TEST_BASE_URL = 'https://paper-api.alpaca.markets';

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    engine = new AlpacaTradingEngine(TEST_API_KEY, TEST_SECRET_KEY, TEST_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Helper: create a mock Response ────────────────────────────────────────
  function mockResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 400,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  // ── 1. engineName_returnsAlpaca ──────────────────────────────────────────
  it('engineName returns "alpaca"', () => {
    expect(engine.engineName()).toBe('alpaca');
  });

  // ── 2. placeOrder_sendsCorrectPostRequest ────────────────────────────────
  it('placeOrder sends POST to /v2/orders with auth headers', async () => {
    const alpacaResponse = {
      id: 'order-123',
      status: 'filled',
      filled_avg_price: '150.00',
      filled_qty: '10',
      filled_at: '2026-03-31T14:30:00Z',
      symbol: 'AAPL',
      side: 'buy',
    };

    mockFetch.mockResolvedValue(mockResponse(alpacaResponse));

    const request: OrderRequest = {
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
      timeInForce: 'day',
    };

    const result = await engine.placeOrder(request);

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-123');
    expect(result.status).toBe('filled');
    expect(result.filledQty).toBe('10');
    expect(result.avgPrice).toBe('150.00');
    expect(result.errorMessage).toBeNull();

    // Verify fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/v2/orders`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'APCA-API-KEY-ID': TEST_API_KEY,
          'APCA-API-SECRET-KEY': TEST_SECRET_KEY,
          'Content-Type': 'application/json',
        }),
      }),
    );

    // Verify request body
    const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
    const parsedBody = JSON.parse(callArgs.body as string);
    expect(parsedBody).toEqual({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
      time_in_force: 'day',
    });
  });

  // ── 3. placeOrder_withLimitPrice_includesLimitPriceInBody ─────────────────
  it('placeOrder includes limit_price and stop_price when provided', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        id: 'order-456',
        status: 'new',
        filled_avg_price: null,
        filled_qty: '0',
        filled_at: null,
        symbol: 'AAPL',
        side: 'buy',
      }),
    );

    const request: OrderRequest = {
      symbol: 'AAPL',
      side: 'buy',
      type: 'stop_limit',
      qty: '5',
      price: '148.00',
      stopPrice: '147.00',
      timeInForce: 'gtc',
    };

    await engine.placeOrder(request);

    const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
    const parsedBody = JSON.parse(callArgs.body as string);
    expect(parsedBody).toEqual({
      symbol: 'AAPL',
      side: 'buy',
      type: 'stop_limit',
      qty: '5',
      limit_price: '148.00',
      stop_price: '147.00',
      time_in_force: 'gtc',
    });
  });

  // ── 4. placeOrder_withNotional_includesNotionalInBody ─────────────────────
  it('placeOrder includes notional when provided', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        id: 'order-789',
        status: 'filled',
        filled_avg_price: '150.00',
        filled_qty: '10',
        filled_at: '2026-03-31T14:30:00Z',
        symbol: 'AAPL',
        side: 'buy',
      }),
    );

    const request: OrderRequest = {
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      notional: '1500',
    };

    await engine.placeOrder(request);

    const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
    const parsedBody = JSON.parse(callArgs.body as string);
    expect(parsedBody.notional).toBe('1500');
    expect(parsedBody.qty).toBeUndefined();
  });

  // ── 5. placeOrder_apiError_returnsRejectedResult ──────────────────────────
  it('placeOrder returns rejected result on API error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ message: 'insufficient funds' }, 422));

    const request: OrderRequest = {
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    };

    const result = await engine.placeOrder(request);

    expect(result.success).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.errorMessage).toContain('Alpaca API error');
  });

  // ── 6. placeOrder_defaultTimeInForce_isDay ────────────────────────────────
  it('placeOrder defaults time_in_force to "day" when not provided', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        id: 'order-abc',
        status: 'filled',
        filled_avg_price: '150.00',
        filled_qty: '10',
        filled_at: '2026-03-31T14:30:00Z',
        symbol: 'AAPL',
        side: 'buy',
      }),
    );

    await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
    const parsedBody = JSON.parse(callArgs.body as string);
    expect(parsedBody.time_in_force).toBe('day');
  });

  // ── 7. getPositions_mapsAlpacaResponse ────────────────────────────────────
  it('getPositions maps Alpaca response to PositionInfo array', async () => {
    const alpacaPositions = [
      {
        symbol: 'AAPL',
        side: 'long',
        qty: '10',
        avg_entry_price: '150.00',
        current_price: '155.00',
        market_value: '1550.00',
        unrealized_pl: '50.00',
        cost_basis: '1500.00',
      },
      {
        symbol: 'MSFT',
        side: 'long',
        qty: '5',
        avg_entry_price: '300.00',
        current_price: '310.00',
        market_value: '1550.00',
        unrealized_pl: '50.00',
        cost_basis: '1500.00',
      },
    ];

    mockFetch.mockResolvedValue(mockResponse(alpacaPositions));

    const positions = await engine.getPositions();

    expect(positions).toHaveLength(2);
    expect(positions[0]).toEqual({
      symbol: 'AAPL',
      side: 'long',
      qty: '10',
      avgEntryPrice: '150.00',
      avgCost: '150.00',
      currentPrice: '155.00',
      marketValue: '1550.00',
      unrealizedPnL: '50.00',
      costBasis: '1500.00',
    });
    expect(positions[1]!.symbol).toBe('MSFT');

    // Verify auth headers on GET
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/v2/positions`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'APCA-API-KEY-ID': TEST_API_KEY,
          'APCA-API-SECRET-KEY': TEST_SECRET_KEY,
        }),
      }),
    );
  });

  // ── 8. getPositions_apiError_returnsEmptyArray ────────────────────────────
  it('getPositions returns empty array on API error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ message: 'unauthorized' }, 401));

    const positions = await engine.getPositions();
    expect(positions).toEqual([]);
  });

  // ── 9. getOrders_mapsAlpacaOrders ─────────────────────────────────────────
  it('getOrders maps Alpaca response to OrderResult array', async () => {
    const alpacaOrders = [
      {
        id: 'order-1',
        status: 'filled',
        filled_avg_price: '150.00',
        filled_qty: '10',
        filled_at: '2026-03-31T14:30:00Z',
        symbol: 'AAPL',
        side: 'buy',
      },
      {
        id: 'order-2',
        status: 'canceled',
        filled_avg_price: null,
        filled_qty: '0',
        filled_at: null,
        symbol: 'MSFT',
        side: 'sell',
      },
    ];

    mockFetch.mockResolvedValue(mockResponse(alpacaOrders));

    const orders = await engine.getOrders();

    expect(orders).toHaveLength(2);
    expect(orders[0]).toEqual(
      expect.objectContaining({
        success: true,
        orderId: 'order-1',
        status: 'filled',
        filledQty: '10',
        avgPrice: '150.00',
        symbol: 'AAPL',
        side: 'buy',
      }),
    );
    expect(orders[1]).toEqual(
      expect.objectContaining({
        success: true,
        orderId: 'order-2',
        status: 'cancelled', // mapped from "canceled"
        filledQty: '0',
      }),
    );

    // Verify query params
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/v2/orders?status=all&limit=50`,
      expect.anything(),
    );
  });

  // ── 10. getOrders_apiError_returnsEmptyArray ──────────────────────────────
  it('getOrders returns empty array on API error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ message: 'error' }, 500));

    const orders = await engine.getOrders();
    expect(orders).toEqual([]);
  });

  // ── 11. syncOrders_queriesOpenOrders ──────────────────────────────────────
  it('syncOrders queries open orders only', async () => {
    const openOrders = [
      {
        id: 'order-open-1',
        status: 'new',
        filled_avg_price: null,
        filled_qty: '0',
        filled_at: null,
        symbol: 'AAPL',
        side: 'buy',
      },
    ];

    mockFetch.mockResolvedValue(mockResponse(openOrders));

    const orders = await engine.syncOrders!();

    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe('pending'); // "new" -> "pending"

    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/v2/orders?status=open&limit=50`,
      expect.anything(),
    );
  });

  // ── 12. getAccount_mapsAlpacaAccount ──────────────────────────────────────
  it('getAccount maps Alpaca response to AccountInfo', async () => {
    const alpacaAccount = {
      cash: '50000.00',
      portfolio_value: '150000.00',
      equity: '150000.00',
      buying_power: '100000.00',
      unrealized_pl: '5000.00',
      realized_pl: '2000.00',
    };

    mockFetch.mockResolvedValue(mockResponse(alpacaAccount));

    const account = await engine.getAccount();

    expect(account.totalValue).toBe(150000);
    expect(account.cashValue).toBe(50000);
    expect(account.buyingPower).toBe(100000);
    expect(account.cash).toBe('50000.00');
    expect(account.portfolioValue).toBe('150000.00');
    expect(account.equity).toBe('150000.00');
    expect(account.unrealizedPnL).toBe('5000.00');
    expect(account.realizedPnL).toBe('2000.00');

    expect(mockFetch).toHaveBeenCalledWith(`${TEST_BASE_URL}/v2/account`, expect.anything());
  });

  // ── 13. getAccount_apiError_returnsZeroValues ─────────────────────────────
  it('getAccount returns zero values on API error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ message: 'error' }, 500));

    const account = await engine.getAccount();

    expect(account.totalValue).toBe(0);
    expect(account.cashValue).toBe(0);
    expect(account.buyingPower).toBe(0);
  });

  // ── 14. cancelOrder_sendDeleteRequest_returnsTrue ─────────────────────────
  it('cancelOrder sends DELETE request and returns true on success', async () => {
    mockFetch.mockResolvedValue(mockResponse({}, 204));

    const result = await engine.cancelOrder('order-to-cancel');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/v2/orders/order-to-cancel`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'APCA-API-KEY-ID': TEST_API_KEY,
          'APCA-API-SECRET-KEY': TEST_SECRET_KEY,
        }),
      }),
    );
  });

  // ── 15. cancelOrder_apiError_returnsFalse ─────────────────────────────────
  it('cancelOrder returns false on API error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ message: 'not found' }, 404));

    const result = await engine.cancelOrder('nonexistent-order');
    expect(result).toBe(false);
  });

  // ── 16. getMarketClock_mapsAlpacaClock ────────────────────────────────────
  it('getMarketClock maps Alpaca response to MarketClock', async () => {
    const alpacaClock = {
      is_open: true,
      next_open: '2026-04-01T13:30:00Z',
      next_close: '2026-03-31T20:00:00Z',
      timestamp: '2026-03-31T15:00:00Z',
    };

    mockFetch.mockResolvedValue(mockResponse(alpacaClock));

    const clock = await engine.getMarketClock!();

    expect(clock.isOpen).toBe(true);
    expect(clock.nextOpen).toBe('2026-04-01T13:30:00Z');
    expect(clock.nextClose).toBe('2026-03-31T20:00:00Z');
    expect(clock.timestamp).toBe('2026-03-31T15:00:00Z');
  });

  // ── 17. getMarketClock_apiError_returnsClosed ─────────────────────────────
  it('getMarketClock returns closed on API error', async () => {
    mockFetch.mockResolvedValue(mockResponse({ message: 'error' }, 500));

    const clock = await engine.getMarketClock!();

    expect(clock.isOpen).toBe(false);
    expect(clock.nextOpen).toBeNull();
    expect(clock.nextClose).toBeNull();
  });

  // ── 18. placeOrder_mapsOrderStatuses ──────────────────────────────────────
  it('maps Alpaca order statuses correctly', async () => {
    const statuses = [
      { input: 'filled', expected: 'filled' },
      { input: 'canceled', expected: 'cancelled' },
      { input: 'rejected', expected: 'rejected' },
      { input: 'expired', expected: 'rejected' },
      { input: 'new', expected: 'pending' },
      { input: 'partially_filled', expected: 'pending' },
      { input: 'accepted', expected: 'pending' },
    ];

    for (const { input, expected } of statuses) {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: `order-${input}`,
          status: input,
          filled_avg_price: '0',
          filled_qty: '0',
          filled_at: null,
          symbol: 'AAPL',
          side: 'buy',
        }),
      );

      const result = await engine.placeOrder({
        symbol: 'AAPL',
        side: 'buy',
        type: 'market',
        qty: '1',
      });

      expect(result.status).toBe(expected);
    }
  });

  // ── 19. constructor_usesDefaultBaseUrl ─────────────────────────────────────
  it('uses default base URL when not provided', async () => {
    const defaultEngine = new AlpacaTradingEngine(TEST_API_KEY, TEST_SECRET_KEY);

    mockFetch.mockResolvedValue(
      mockResponse({
        id: 'order-default',
        status: 'filled',
        filled_avg_price: '100',
        filled_qty: '1',
        filled_at: null,
        symbol: 'AAPL',
        side: 'buy',
      }),
    );

    await defaultEngine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '1',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/orders',
      expect.anything(),
    );
  });

  // ── 20. placeOrder_networkError_returnsRejected ───────────────────────────
  it('placeOrder handles network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await engine.placeOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.errorMessage).toBe('Network error');
  });

  // ── 21. getPositions_networkError_returnsEmptyArray ───────────────────────
  it('getPositions handles network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const positions = await engine.getPositions();
    expect(positions).toEqual([]);
  });
});
