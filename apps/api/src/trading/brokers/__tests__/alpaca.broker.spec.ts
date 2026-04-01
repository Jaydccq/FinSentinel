import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlpacaBroker } from '../alpaca.broker';
import { AlpacaTradingEngine } from '../../engines/alpaca-trading.engine';
import { SecurityType, BrokerCapability, Contract } from '@finsentinel/shared';

// ── Mock AlpacaTradingEngine ──────────────────────────────────────────────────
function createMockEngine(): AlpacaTradingEngine {
  return {
    engineName: vi.fn().mockReturnValue('alpaca'),
    placeOrder: vi.fn().mockResolvedValue({
      success: true,
      orderId: 'order-123',
      status: 'filled',
      filledQty: '10',
      avgPrice: '150.00',
      errorMessage: null,
      timestamp: '2026-03-31T14:30:00Z',
    }),
    getPositions: vi.fn().mockResolvedValue([
      {
        symbol: 'AAPL',
        side: 'long',
        qty: '10',
        avgCost: '150.00',
        currentPrice: '155.00',
        unrealizedPnL: '50.00',
      },
    ]),
    getOrders: vi.fn().mockResolvedValue([
      {
        success: true,
        orderId: 'order-123',
        status: 'filled',
        filledQty: '10',
        avgPrice: '150.00',
        errorMessage: null,
        timestamp: '2026-03-31T14:30:00Z',
      },
    ]),
    getAccount: vi.fn().mockResolvedValue({
      totalValue: 150000,
      cashValue: 50000,
      buyingPower: 100000,
    }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    syncOrders: vi.fn().mockResolvedValue([]),
    getMarketClock: vi.fn().mockResolvedValue({
      isOpen: true,
      nextOpen: '2026-04-01T13:30:00Z',
      nextClose: '2026-03-31T20:00:00Z',
      timestamp: '2026-03-31T15:00:00Z',
    }),
  } as unknown as AlpacaTradingEngine;
}

describe('AlpacaBroker', () => {
  let broker: AlpacaBroker;
  let mockEngine: AlpacaTradingEngine;

  beforeEach(() => {
    mockEngine = createMockEngine();
    broker = new AlpacaBroker(mockEngine);
  });

  // ── 1. brokerId_returnsAlpaca ─────────────────────────────────────────────
  it('brokerId returns "alpaca"', () => {
    expect(broker.brokerId()).toBe('alpaca');
  });

  // ── 2. displayName_returnsCorrectName ─────────────────────────────────────
  it('displayName returns "Alpaca (US Equities)"', () => {
    expect(broker.displayName()).toBe('Alpaca (US Equities)');
  });

  // ── 3. supportedSecurityTypes_containsStockOnly ───────────────────────────
  it('supportedSecurityTypes contains STOCK only', () => {
    const supported = broker.supportedSecurityTypes();

    expect(supported.has(SecurityType.STOCK)).toBe(true);
    expect(supported.size).toBe(1);
    expect(supported.has(SecurityType.CRYPTO)).toBe(false);
    expect(supported.has(SecurityType.PERP)).toBe(false);
    expect(supported.has(SecurityType.OPTION)).toBe(false);
  });

  // ── 4. capabilities_containsSpotTradingOnly ──────────────────────────────
  it('capabilities contains SPOT_TRADING only', () => {
    const caps = broker.capabilities();

    expect(caps.has(BrokerCapability.SPOT_TRADING)).toBe(true);
    expect(caps.size).toBe(1);
  });

  // ── 5. canHandle_returnsTrueForStockContracts ─────────────────────────────
  it('canHandle returns true for stock contracts', () => {
    const stockContract = Contract.stock('AAPL');
    expect(broker.canHandle(stockContract)).toBe(true);
  });

  // ── 6. canHandle_returnsFalseForCryptoContracts ───────────────────────────
  it('canHandle returns false for crypto contracts', () => {
    const cryptoContract = Contract.cryptoSpot('BTC', 'BINANCE', 'USD');
    expect(broker.canHandle(cryptoContract)).toBe(false);
  });

  // ── 7. canHandle_returnsFalseForPerpContracts ─────────────────────────────
  it('canHandle returns false for perp contracts', () => {
    const perpContract = Contract.cryptoPerp('BTC', 'OKX', 'USDT');
    expect(broker.canHandle(perpContract)).toBe(false);
  });

  // ── 8. placeOrder_convertsContractSymbolAndDelegatesToEngine ──────────────
  it('placeOrder converts contract symbol and delegates to engine', async () => {
    const contract = Contract.stock('AAPL');

    const result = await broker.placeOrder(contract, {
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      qty: '10',
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-123');

    // Verify engine was called with the contract's engine symbol (AAPL for stocks)
    expect(mockEngine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'AAPL',
        side: 'buy',
        type: 'market',
        qty: '10',
      }),
    );
  });

  // ── 9. placeOrder_usesToEngineSymbolFromContract ──────────────────────────
  it('placeOrder uses toEngineSymbol() from the contract', async () => {
    // Even though Alpaca only supports stocks, the broker converts via toEngineSymbol()
    const contract = Contract.stock('TSLA');

    await broker.placeOrder(contract, {
      symbol: 'original-symbol',
      side: 'sell',
      type: 'limit',
      qty: '5',
      price: '200.00',
    });

    // The symbol should be overridden with contract.toEngineSymbol() = "TSLA"
    expect(mockEngine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'TSLA',
        side: 'sell',
        type: 'limit',
        qty: '5',
        price: '200.00',
      }),
    );
  });

  // ── 10. getPositions_delegatesToEngine ─────────────────────────────────────
  it('getPositions delegates to engine', async () => {
    const positions = await broker.getPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]!.symbol).toBe('AAPL');
    expect(mockEngine.getPositions).toHaveBeenCalledOnce();
  });

  // ── 11. getOrders_delegatesToEngine ───────────────────────────────────────
  it('getOrders delegates to engine', async () => {
    const orders = await broker.getOrders();

    expect(orders).toHaveLength(1);
    expect(orders[0]!.orderId).toBe('order-123');
    expect(mockEngine.getOrders).toHaveBeenCalledOnce();
  });

  // ── 12. getAccount_delegatesToEngine ──────────────────────────────────────
  it('getAccount delegates to engine', async () => {
    const account = await broker.getAccount();

    expect(account.totalValue).toBe(150000);
    expect(account.cashValue).toBe(50000);
    expect(mockEngine.getAccount).toHaveBeenCalledOnce();
  });

  // ── 13. cancelOrder_delegatesToEngine ─────────────────────────────────────
  it('cancelOrder delegates to engine', async () => {
    const result = await broker.cancelOrder('order-456');

    expect(result).toBe(true);
    expect(mockEngine.cancelOrder).toHaveBeenCalledWith('order-456');
  });

  // ── 14. syncOrders_delegatesToEngine ──────────────────────────────────────
  it('syncOrders delegates to engine', async () => {
    const orders = await broker.syncOrders();

    expect(orders).toEqual([]);
    expect(mockEngine.syncOrders).toHaveBeenCalledOnce();
  });

  // ── 15. getMarketClock_delegatesToEngine ──────────────────────────────────
  it('getMarketClock delegates to engine', async () => {
    const clock = await broker.getMarketClock();

    expect(clock.isOpen).toBe(true);
    expect(clock.nextOpen).toBe('2026-04-01T13:30:00Z');
    expect(mockEngine.getMarketClock).toHaveBeenCalledOnce();
  });

  // ── 16. searchContracts_returnsEmptyArray ─────────────────────────────────
  it('searchContracts returns empty array', async () => {
    const contracts = await broker.searchContracts('AAPL');
    expect(contracts).toEqual([]);
  });

  // ── 17. engine_exposesUnderlyingEngine ────────────────────────────────────
  it('engine() exposes the underlying AlpacaTradingEngine', () => {
    expect(broker.engine()).toBe(mockEngine);
  });
});
