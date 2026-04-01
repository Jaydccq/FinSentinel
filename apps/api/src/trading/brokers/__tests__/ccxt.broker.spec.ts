import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CcxtBroker } from '../ccxt.broker';
import { CcxtTradingEngine } from '../../engines/ccxt-trading.engine';
import { SecurityType, BrokerCapability, Contract } from '@finsentinel/shared';

// ── Mock CcxtTradingEngine ──────────────────────────────────────────────────
function createMockEngine(): CcxtTradingEngine {
  return {
    engineName: vi.fn().mockReturnValue('ccxt'),
    placeOrder: vi.fn().mockResolvedValue({
      success: true,
      orderId: 'order-btc-001',
      status: 'filled',
      filledQty: '0.5',
      avgPrice: '42000',
      errorMessage: null,
      timestamp: '2026-03-31T10:00:00Z',
    }),
    getPositions: vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT',
        side: 'long',
        qty: '0.5',
        avgCost: '41000',
        currentPrice: '42000',
        unrealizedPnL: '500',
      },
    ]),
    getOrders: vi.fn().mockResolvedValue([
      {
        success: true,
        orderId: 'order-btc-001',
        status: 'filled',
        filledQty: '0.5',
        avgPrice: '42000',
        errorMessage: null,
        timestamp: '2026-03-31T10:00:00Z',
      },
    ]),
    getAccount: vi.fn().mockResolvedValue({
      totalValue: 50000,
      cashValue: 30000,
      buyingPower: 30000,
    }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    syncOrders: vi.fn().mockResolvedValue([]),
    getMarketClock: vi.fn().mockResolvedValue({
      isOpen: true,
      nextOpen: null,
      nextClose: null,
      timestamp: '2026-03-31T10:00:00Z',
    }),
  } as unknown as CcxtTradingEngine;
}

describe('CcxtBroker', () => {
  let broker: CcxtBroker;
  let mockEngine: CcxtTradingEngine;

  beforeEach(() => {
    mockEngine = createMockEngine();
    broker = new CcxtBroker(mockEngine);
  });

  // ── 1. brokerId_returnsCcxt ──────────────────────────────────────────────
  it('brokerId returns "ccxt"', () => {
    expect(broker.brokerId()).toBe('ccxt');
  });

  // ── 2. displayName_returnsCorrectName ────────────────────────────────────
  it('displayName returns "CCXT (Crypto)"', () => {
    expect(broker.displayName()).toBe('CCXT (Crypto)');
  });

  // ── 3. supportedSecurityTypes_containsCryptoOnly ─────────────────────────
  it('supportedSecurityTypes contains CRYPTO only', () => {
    const supported = broker.supportedSecurityTypes();

    expect(supported.has(SecurityType.CRYPTO)).toBe(true);
    expect(supported.size).toBe(1);
    expect(supported.has(SecurityType.STOCK)).toBe(false);
    expect(supported.has(SecurityType.PERP)).toBe(false);
    expect(supported.has(SecurityType.OPTION)).toBe(false);
  });

  // ── 4. capabilities_containsSpotTradingOnly ─────────────────────────────
  it('capabilities contains SPOT_TRADING only', () => {
    const caps = broker.capabilities();

    expect(caps.has(BrokerCapability.SPOT_TRADING)).toBe(true);
    expect(caps.size).toBe(1);
  });

  // ── 5. canHandle_returnsTrueForCryptoContracts ──────────────────────────
  it('canHandle returns true for crypto spot contracts', () => {
    const cryptoContract = Contract.cryptoSpot('BTC', 'BINANCE', 'USDT');
    expect(broker.canHandle(cryptoContract)).toBe(true);
  });

  // ── 6. canHandle_returnsFalseForStockContracts ──────────────────────────
  it('canHandle returns false for stock contracts', () => {
    const stockContract = Contract.stock('AAPL');
    expect(broker.canHandle(stockContract)).toBe(false);
  });

  // ── 7. canHandle_returnsFalseForPerpContracts ───────────────────────────
  it('canHandle returns false for perp contracts', () => {
    const perpContract = Contract.cryptoPerp('BTC', 'OKX', 'USDT');
    expect(broker.canHandle(perpContract)).toBe(false);
  });

  // ── 8. placeOrder_convertsContractSymbolAndDelegatesToEngine ─────────────
  it('placeOrder converts contract symbol and delegates to engine', async () => {
    const contract = Contract.cryptoSpot('BTC', 'BINANCE', 'USDT');

    const result = await broker.placeOrder(contract, {
      symbol: 'BTC',
      side: 'buy',
      type: 'market',
      qty: '0.5',
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-btc-001');

    // Verify engine was called with the contract's engine symbol (BTC/USDT)
    expect(mockEngine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTC/USDT',
        side: 'buy',
        type: 'market',
        qty: '0.5',
      }),
    );
  });

  // ── 9. placeOrder_usesToEngineSymbolFromContract ────────────────────────
  it('placeOrder uses toEngineSymbol() from the contract', async () => {
    const contract = Contract.cryptoSpot('ETH', 'KRAKEN', 'USD');

    await broker.placeOrder(contract, {
      symbol: 'original-symbol',
      side: 'sell',
      type: 'limit',
      qty: '5',
      price: '3500.00',
    });

    // The symbol should be overridden with contract.toEngineSymbol() = "ETH/USD"
    expect(mockEngine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ETH/USD',
        side: 'sell',
        type: 'limit',
        qty: '5',
        price: '3500.00',
      }),
    );
  });

  // ── 10. getPositions_delegatesToEngine ────────────────────────────────────
  it('getPositions delegates to engine', async () => {
    const positions = await broker.getPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]!.symbol).toBe('BTC/USDT');
    expect(mockEngine.getPositions).toHaveBeenCalledOnce();
  });

  // ── 11. getOrders_delegatesToEngine ──────────────────────────────────────
  it('getOrders delegates to engine', async () => {
    const orders = await broker.getOrders();

    expect(orders).toHaveLength(1);
    expect(orders[0]!.orderId).toBe('order-btc-001');
    expect(mockEngine.getOrders).toHaveBeenCalledOnce();
  });

  // ── 12. getAccount_delegatesToEngine ─────────────────────────────────────
  it('getAccount delegates to engine', async () => {
    const account = await broker.getAccount();

    expect(account.totalValue).toBe(50000);
    expect(account.cashValue).toBe(30000);
    expect(mockEngine.getAccount).toHaveBeenCalledOnce();
  });

  // ── 13. cancelOrder_delegatesToEngine ────────────────────────────────────
  it('cancelOrder delegates to engine', async () => {
    const result = await broker.cancelOrder('order-456');

    expect(result).toBe(true);
    expect(mockEngine.cancelOrder).toHaveBeenCalledWith('order-456');
  });

  // ── 14. syncOrders_delegatesToEngine ─────────────────────────────────────
  it('syncOrders delegates to engine', async () => {
    const orders = await broker.syncOrders();

    expect(orders).toEqual([]);
    expect(mockEngine.syncOrders).toHaveBeenCalledOnce();
  });

  // ── 15. getMarketClock_delegatesToEngine ─────────────────────────────────
  it('getMarketClock delegates to engine', async () => {
    const clock = await broker.getMarketClock();

    expect(clock.isOpen).toBe(true);
    expect(clock.nextOpen).toBeNull();
    expect(clock.nextClose).toBeNull();
    expect(mockEngine.getMarketClock).toHaveBeenCalledOnce();
  });

  // ── 16. searchContracts_returnsEmptyArray ────────────────────────────────
  it('searchContracts returns empty array', async () => {
    const contracts = await broker.searchContracts('BTC');
    expect(contracts).toEqual([]);
  });

  // ── 17. engine_exposesUnderlyingEngine ───────────────────────────────────
  it('engine() exposes the underlying CcxtTradingEngine', () => {
    expect(broker.engine()).toBe(mockEngine);
  });
});
