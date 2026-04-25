import { describe, it, expect } from 'vitest';
import { Contract } from '../contract';
import { SecurityType } from '../../enums/security-type';

describe('Contract', () => {
  // 1. stockContract_createdWithMinimalFields
  it('stock contract created with minimal fields', () => {
    const contract = Contract.stock('AAPL');
    expect(contract.symbol).toBe('AAPL');
    expect(contract.secType).toBe(SecurityType.STOCK);
    expect(contract.exchange).toBe('US');
    expect(contract.currency).toBe('USD');
    expect(contract.expiry).toBeNull();
    expect(contract.strike).toBeNull();
    expect(contract.right).toBeNull();
    expect(contract.multiplier).toBe(1);
  });

  // 2. cryptoPerpContract_includesExchange
  it('crypto perp contract includes exchange', () => {
    const contract = Contract.cryptoPerp('BTC', 'OKX', 'USDT');
    expect(contract.symbol).toBe('BTC');
    expect(contract.secType).toBe(SecurityType.PERP);
    expect(contract.exchange).toBe('OKX');
    expect(contract.currency).toBe('USDT');
    expect(contract.expiry).toBeNull();
    expect(contract.strike).toBeNull();
    expect(contract.right).toBeNull();
    expect(contract.multiplier).toBe(1);
  });

  // 3. cryptoSpotContract_forCcxtExchanges
  it('crypto spot contract for CCXT exchanges', () => {
    const contract = Contract.cryptoSpot('ETH', 'binance', 'USDT');
    expect(contract.symbol).toBe('ETH');
    expect(contract.secType).toBe(SecurityType.CRYPTO);
    expect(contract.exchange).toBe('binance');
    expect(contract.currency).toBe('USDT');
  });

  // 4. toEngineSymbol_convertsToNativeFormat
  describe('toEngineSymbol converts to native format', () => {
    it('STOCK returns symbol', () => {
      expect(Contract.stock('AAPL').toEngineSymbol()).toBe('AAPL');
    });

    it('PERP returns symbol-currency-SWAP', () => {
      expect(Contract.cryptoPerp('BTC', 'OKX', 'USDT').toEngineSymbol()).toBe('BTC-USDT-SWAP');
    });

    it('CRYPTO returns symbol/currency', () => {
      expect(Contract.cryptoSpot('BTC', 'binance', 'USD').toEngineSymbol()).toBe('BTC/USD');
    });

    it('FUTURE returns symbol-currency-YYMMDD', () => {
      const contract = Contract.fromString('BTC-USD-250328');
      expect(contract.toEngineSymbol()).toBe('BTC-USD-250328');
    });

    it('FOREX returns symbol/currency', () => {
      const contract = Contract.fromString('EUR-USD');
      expect(contract.toEngineSymbol()).toBe('EUR/USD');
    });
  });

  // 5. fromString_parsesNaturalLanguageSymbols
  describe('fromString parses natural language symbols', () => {
    it('parses plain stock ticker', () => {
      const contract = Contract.fromString('AAPL');
      expect(contract.secType).toBe(SecurityType.STOCK);
      expect(contract.symbol).toBe('AAPL');
    });

    it('parses OKX perpetual swap', () => {
      const contract = Contract.fromString('BTC-USDT-SWAP');
      expect(contract.secType).toBe(SecurityType.PERP);
      expect(contract.symbol).toBe('BTC');
      expect(contract.currency).toBe('USDT');
      expect(contract.exchange).toBe('OKX');
    });

    it('parses crypto spot with slash', () => {
      const contract = Contract.fromString('BTC/USD');
      expect(contract.secType).toBe(SecurityType.CRYPTO);
      expect(contract.symbol).toBe('BTC');
      expect(contract.currency).toBe('USD');
    });

    it('parses crypto pair with dash', () => {
      const contract = Contract.fromString('ETH-USDT');
      expect(contract.secType).toBe(SecurityType.CRYPTO);
      expect(contract.symbol).toBe('ETH');
      expect(contract.currency).toBe('USDT');
    });

    it('parses dated future', () => {
      const contract = Contract.fromString('BTC-USD-250328');
      expect(contract.secType).toBe(SecurityType.FUTURE);
      expect(contract.symbol).toBe('BTC');
      expect(contract.currency).toBe('USD');
      expect(contract.expiry).toBe('2025-03-28');
    });
  });

  // 6. displayName_humanReadable
  describe('displayName returns human readable text', () => {
    it('STOCK displays as "AAPL (Stock)"', () => {
      expect(Contract.stock('AAPL').displayName()).toBe('AAPL (Stock)');
    });

    it('PERP displays as "BTC-USDT Perp @OKX"', () => {
      expect(Contract.cryptoPerp('BTC', 'OKX', 'USDT').displayName()).toBe('BTC-USDT Perp @OKX');
    });

    it('CRYPTO displays as "BTC/USD Spot @binance"', () => {
      expect(Contract.cryptoSpot('BTC', 'binance', 'USD').displayName()).toBe(
        'BTC/USD Spot @binance',
      );
    });

    it('FUTURE displays with expiry date', () => {
      const contract = Contract.fromString('BTC-USD-250328');
      expect(contract.displayName()).toBe('BTC-USD Future 2025-03-28');
    });

    it('FOREX displays as "EUR/USD Forex"', () => {
      const contract = Contract.fromString('EUR-USD');
      expect(contract.displayName()).toBe('EUR/USD Forex');
    });
  });

  // 7. fromString_rejectsBlankInput
  it('fromString rejects blank input', () => {
    expect(() => Contract.fromString('')).toThrow();
    expect(() => Contract.fromString('   ')).toThrow();
  });

  // 8. fromString_detectsForexPairs
  describe('fromString detects forex pairs', () => {
    it('detects EUR-USD as FOREX', () => {
      const contract = Contract.fromString('EUR-USD');
      expect(contract.secType).toBe(SecurityType.FOREX);
      expect(contract.symbol).toBe('EUR');
      expect(contract.currency).toBe('USD');
    });

    it('detects GBP-JPY as FOREX', () => {
      const contract = Contract.fromString('GBP-JPY');
      expect(contract.secType).toBe(SecurityType.FOREX);
      expect(contract.symbol).toBe('GBP');
      expect(contract.currency).toBe('JPY');
    });
  });

  // 9. fromString_parsesOkxDatedFutureWithExpiry
  it('fromString parses OKX dated future with expiry', () => {
    const contract = Contract.fromString('BTC-USD-250328');
    expect(contract.secType).toBe(SecurityType.FUTURE);
    expect(contract.symbol).toBe('BTC');
    expect(contract.currency).toBe('USD');
    expect(contract.expiry).toBe('2025-03-28');
  });

  // 10. equality_basedOnCanonicalFields
  it('equality is based on canonical fields', () => {
    const a = Contract.stock('AAPL');
    const b = Contract.stock('AAPL');
    expect(a.equals(b)).toBe(true);

    const c = Contract.stock('GOOG');
    expect(a.equals(c)).toBe(false);

    const d = Contract.cryptoPerp('BTC', 'OKX', 'USDT');
    const e = Contract.cryptoPerp('BTC', 'OKX', 'USDT');
    expect(d.equals(e)).toBe(true);
  });
});
