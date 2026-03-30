import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperBroker } from '../paper.broker';
import { PaperTradingEngine } from '../../engines/paper-trading.engine';
import type { MarketDataService } from '../../../market/market-data.service';
import { SecurityType, BrokerCapability, Contract } from '@finsentinel/shared';

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

describe('PaperBroker', () => {
  let broker: PaperBroker;
  let mockMarketData: MarketDataService;
  let engine: PaperTradingEngine;

  beforeEach(() => {
    mockMarketData = createMockMarketDataService();
    engine = new PaperTradingEngine(mockMarketData, 100000);
    broker = new PaperBroker(engine);
  });

  // ── 1. placeOrder_convertsContractToNativeSymbol_andDelegates ────────────
  it('placeOrder converts crypto contract to native Polygon symbol', async () => {
    const contract = Contract.cryptoSpot('BTC', 'POLYGON', 'USD');

    // Mock BTC at $50000
    (mockMarketData.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ticker: 'X:BTCUSD',
      close: '50000.00',
      open: '49000.00',
      high: '51000.00',
      low: '48000.00',
      volume: 10000,
      timestamp: Date.now(),
    });

    const result = await broker.placeOrder(contract, {
      symbol: 'BTC',
      side: 'buy',
      type: 'market',
      qty: '1',
    });

    expect(result.success).toBe(true);

    // Verify the engine received the Polygon-format symbol "X:BTCUSD"
    expect(mockMarketData.getQuote).toHaveBeenCalledWith('X:BTCUSD');
  });

  // ── 2. supportedSecurityTypes_includesAllTypes ──────────────────────────
  it('supportedSecurityTypes includes all SecurityType values', () => {
    const supported = broker.supportedSecurityTypes();

    expect(supported.has(SecurityType.STOCK)).toBe(true);
    expect(supported.has(SecurityType.CRYPTO)).toBe(true);
    expect(supported.has(SecurityType.PERP)).toBe(true);
    expect(supported.has(SecurityType.OPTION)).toBe(true);
    expect(supported.has(SecurityType.FUTURE)).toBe(true);
    expect(supported.has(SecurityType.FOREX)).toBe(true);
  });

  // ── 3. canHandle_returnsTrueForStockContracts ───────────────────────────
  it('canHandle returns true for stock contracts', () => {
    const contract = Contract.stock('AAPL');
    expect(broker.canHandle(contract)).toBe(true);
  });

  // ── 4. brokerIdAndDisplayName_areCorrect ────────────────────────────────
  it('brokerId and displayName are correct', () => {
    expect(broker.brokerId()).toBe('paper');
    expect(broker.displayName()).toBe('Paper Trading (Simulated)');
  });

  // ── 5. capabilities_containsSpotAndMarketData ──────────────────────────
  it('capabilities contain SPOT_TRADING and MARKET_DATA', () => {
    const caps = broker.capabilities();

    expect(caps.has(BrokerCapability.SPOT_TRADING)).toBe(true);
    expect(caps.has(BrokerCapability.MARKET_DATA)).toBe(true);
    expect(caps.size).toBe(2);
  });

  // ── 6. engine_exposesUnderlyingEngine ──────────────────────────────────
  it('engine() exposes the underlying PaperTradingEngine', () => {
    expect(broker.engine()).toBe(engine);
  });
});
