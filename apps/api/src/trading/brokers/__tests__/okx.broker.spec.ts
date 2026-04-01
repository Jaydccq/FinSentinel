import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OkxBroker } from '../okx.broker';
import { OkxTradingEngine } from '../../../okx/okx-trading.engine';
import { SecurityType, BrokerCapability, Contract } from '@finsentinel/shared';

// ── Mock OkxTradingEngine ──────────────────────────────────────────────────
function createMockEngine(): OkxTradingEngine {
  return {
    engineName: vi.fn().mockReturnValue('okx'),
    placeOrder: vi.fn().mockResolvedValue({
      success: true,
      orderId: 'okx-order-123',
      status: 'filled',
      filledQty: '1',
      avgPrice: '65000.00',
      errorMessage: null,
      timestamp: '2026-03-31T14:30:00Z',
    }),
    getPositions: vi.fn().mockResolvedValue([
      {
        symbol: 'BTC-USDT-SWAP',
        side: 'long',
        qty: '10',
        avgCost: '64000',
        currentPrice: '65000',
        unrealizedPnL: '10000',
      },
    ]),
    getOrders: vi.fn().mockResolvedValue([]),
    getAccount: vi.fn().mockResolvedValue({
      totalValue: 150000,
      cashValue: 95000,
      buyingPower: 95000,
    }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    syncOrders: vi.fn().mockResolvedValue([]),
    getMarketClock: vi.fn().mockResolvedValue({
      isOpen: true,
      nextOpen: null,
      nextClose: null,
      timestamp: '2026-03-31T15:00:00Z',
    }),
  } as unknown as OkxTradingEngine;
}

describe('OkxBroker', () => {
  let broker: OkxBroker;
  let mockEngine: OkxTradingEngine;

  beforeEach(() => {
    mockEngine = createMockEngine();
    broker = new OkxBroker(mockEngine);
  });

  // ── 1. brokerId_returnsOkx ──────────────────────────────────────────────
  it('brokerId returns "okx"', () => {
    expect(broker.brokerId()).toBe('okx');
  });

  // ── 2. displayName_returnsCorrectName ───────────────────────────────────
  it('displayName returns "OKX (Crypto Derivatives)"', () => {
    expect(broker.displayName()).toBe('OKX (Crypto Derivatives)');
  });

  // ── 3. supportedSecurityTypes_containsPerpAndFuture ─────────────────────
  it('supportedSecurityTypes contains PERP and FUTURE', () => {
    const supported = broker.supportedSecurityTypes();

    expect(supported.has(SecurityType.PERP)).toBe(true);
    expect(supported.has(SecurityType.FUTURE)).toBe(true);
    expect(supported.size).toBe(2);
    expect(supported.has(SecurityType.STOCK)).toBe(false);
    expect(supported.has(SecurityType.CRYPTO)).toBe(false);
  });

  // ── 4. capabilities_containsPerpSwapAndMarginTrading ────────────────────
  it('capabilities contains PERPETUAL_SWAP and MARGIN_TRADING', () => {
    const caps = broker.capabilities();

    expect(caps.has(BrokerCapability.PERPETUAL_SWAP)).toBe(true);
    expect(caps.has(BrokerCapability.MARGIN_TRADING)).toBe(true);
    expect(caps.size).toBe(2);
    expect(caps.has(BrokerCapability.SPOT_TRADING)).toBe(false);
  });

  // ── 5. canHandle_returnsTrueForPerpContracts ────────────────────────────
  it('canHandle returns true for perp contracts', () => {
    const perpContract = Contract.cryptoPerp('BTC', 'OKX', 'USDT');
    expect(broker.canHandle(perpContract)).toBe(true);
  });

  // ── 6. canHandle_returnsTrueForFutureContracts ──────────────────────────
  it('canHandle returns true for future contracts', () => {
    // Create a future contract via fromString
    const futureContract = Contract.fromString('BTC-USD-250328');
    expect(broker.canHandle(futureContract)).toBe(true);
  });

  // ── 7. canHandle_returnsFalseForStockContracts ──────────────────────────
  it('canHandle returns false for stock contracts', () => {
    const stockContract = Contract.stock('AAPL');
    expect(broker.canHandle(stockContract)).toBe(false);
  });

  // ── 8. canHandle_returnsFalseForCryptoSpotContracts ─────────────────────
  it('canHandle returns false for crypto spot contracts', () => {
    const cryptoContract = Contract.cryptoSpot('BTC', 'BINANCE', 'USD');
    expect(broker.canHandle(cryptoContract)).toBe(false);
  });

  // ── 9. placeOrder_convertsContractSymbolAndDelegatesToEngine ────────────
  it('placeOrder converts contract symbol via toEngineSymbol and delegates', async () => {
    const contract = Contract.cryptoPerp('BTC', 'OKX', 'USDT');

    const result = await broker.placeOrder(contract, {
      symbol: 'original-symbol',
      side: 'buy',
      type: 'market',
      qty: '1',
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('okx-order-123');

    // The symbol should be overridden with contract.toEngineSymbol() = "BTC-USDT-SWAP"
    expect(mockEngine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTC-USDT-SWAP',
        side: 'buy',
        type: 'market',
        qty: '1',
      }),
    );
  });

  // ── 10. placeOrder_preservesOrderFields ─────────────────────────────────
  it('placeOrder preserves all order request fields except symbol', async () => {
    const contract = Contract.cryptoPerp('ETH', 'OKX', 'USDT');

    await broker.placeOrder(contract, {
      symbol: 'should-be-overridden',
      side: 'sell',
      type: 'limit',
      qty: '10',
      price: '3500',
      reduceOnly: true,
    });

    expect(mockEngine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ETH-USDT-SWAP',
        side: 'sell',
        type: 'limit',
        qty: '10',
        price: '3500',
        reduceOnly: true,
      }),
    );
  });

  // ── 11. getPositions_delegatesToEngine ──────────────────────────────────
  it('getPositions delegates to engine', async () => {
    const positions = await broker.getPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]!.symbol).toBe('BTC-USDT-SWAP');
    expect(mockEngine.getPositions).toHaveBeenCalledOnce();
  });

  // ── 12. getOrders_delegatesToEngine ────────────────────────────────────
  it('getOrders delegates to engine', async () => {
    const orders = await broker.getOrders();

    expect(orders).toEqual([]);
    expect(mockEngine.getOrders).toHaveBeenCalledOnce();
  });

  // ── 13. getAccount_delegatesToEngine ───────────────────────────────────
  it('getAccount delegates to engine', async () => {
    const account = await broker.getAccount();

    expect(account.totalValue).toBe(150000);
    expect(account.cashValue).toBe(95000);
    expect(mockEngine.getAccount).toHaveBeenCalledOnce();
  });

  // ── 14. cancelOrder_delegatesToEngine ──────────────────────────────────
  it('cancelOrder delegates to engine', async () => {
    const result = await broker.cancelOrder('okx-order-456');

    expect(result).toBe(true);
    expect(mockEngine.cancelOrder).toHaveBeenCalledWith('okx-order-456');
  });

  // ── 15. syncOrders_delegatesToEngine ───────────────────────────────────
  it('syncOrders delegates to engine', async () => {
    const orders = await broker.syncOrders();

    expect(orders).toEqual([]);
    expect(mockEngine.syncOrders).toHaveBeenCalledOnce();
  });

  // ── 16. getMarketClock_delegatesToEngine ───────────────────────────────
  it('getMarketClock delegates to engine (crypto always open)', async () => {
    const clock = await broker.getMarketClock();

    expect(clock.isOpen).toBe(true);
    expect(clock.nextOpen).toBeNull();
    expect(mockEngine.getMarketClock).toHaveBeenCalledOnce();
  });

  // ── 17. searchContracts_returnsEmptyArray ──────────────────────────────
  it('searchContracts returns empty array', async () => {
    const contracts = await broker.searchContracts('BTC');
    expect(contracts).toEqual([]);
  });

  // ── 18. engine_exposesUnderlyingEngine ─────────────────────────────────
  it('engine() exposes the underlying OkxTradingEngine', () => {
    expect(broker.engine()).toBe(mockEngine);
  });
});
