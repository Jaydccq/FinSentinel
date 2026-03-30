import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrokerRegistry } from '../broker-registry.service';
import { PaperBroker } from '../brokers/paper.broker';
import type { MarketDataService } from '../../market/market-data.service';
import { SecurityType, TradingMode, Contract } from '@finsentinel/shared';

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

describe('BrokerRegistry', () => {
  let registry: BrokerRegistry;
  let mockMarketData: MarketDataService;

  beforeEach(() => {
    mockMarketData = createMockMarketDataService();
    registry = new BrokerRegistry(mockMarketData);
  });

  // ── 1. paperMode_alwaysReturnsPaperBroker ──────────────────────────────
  it('resolve in PAPER mode always returns a PaperBroker', () => {
    const contract = Contract.stock('AAPL');
    const broker = registry.resolve(contract, TradingMode.PAPER, 100000);

    expect(broker).toBeInstanceOf(PaperBroker);
    expect(broker.brokerId()).toBe('paper');
  });

  // ── 2. paperMode_handlesAnySecurity ────────────────────────────────────
  it('resolve in PAPER mode handles any security type', () => {
    const stockBroker = registry.resolve(
      Contract.stock('AAPL'),
      TradingMode.PAPER,
      100000,
    );
    const cryptoBroker = registry.resolve(
      Contract.cryptoSpot('BTC', 'POLYGON', 'USD'),
      TradingMode.PAPER,
      100000,
    );
    const perpBroker = registry.resolve(
      Contract.cryptoPerp('ETH', 'OKX', 'USDT'),
      TradingMode.PAPER,
      100000,
    );

    expect(stockBroker).toBeInstanceOf(PaperBroker);
    expect(cryptoBroker).toBeInstanceOf(PaperBroker);
    expect(perpBroker).toBeInstanceOf(PaperBroker);
  });

  // ── 3. liveMode_noEnabledBroker_throwsException ───────────────────────
  it('resolve in LIVE mode with no enabled brokers throws', () => {
    const contract = Contract.stock('AAPL');

    expect(() =>
      registry.resolve(contract, TradingMode.LIVE, 100000),
    ).toThrow('No live broker can handle');
  });

  // ── 4. listAvailableBrokers_includesPaperAlways ───────────────────────
  it('listAvailableBrokers always includes PaperBroker', () => {
    const brokers = registry.listAvailableBrokers(TradingMode.PAPER, 100000);

    expect(brokers.length).toBeGreaterThanOrEqual(1);
    expect(brokers.some((b) => b.brokerId() === 'paper')).toBe(true);
  });
});
