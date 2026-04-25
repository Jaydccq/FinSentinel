import { SecurityType } from '../enums/security-type';

/**
 * Full set of fiat currency codes used for forex pair detection.
 */
const FIAT_CURRENCIES = new Set([
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'NZD',
  'HKD',
  'SGD',
  'CNY',
  'CNH',
  'KRW',
  'INR',
  'MXN',
  'BRL',
  'TRY',
  'ZAR',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'TWD',
  'THB',
  'MYR',
  'PHP',
  'IDR',
  'ILS',
  'ARS',
  'CLP',
  'COP',
  'PEN',
  'EGP',
  'KWD',
  'AED',
  'SAR',
  'QAR',
  'BHD',
  'OMR',
]);

/** Regex for OKX-style dated futures: e.g. BTC-USD-250328 */
const DATED_FUTURE_PATTERN = /^[A-Z]+-[A-Z]+-\d{6}$/;

/**
 * Immutable value object representing a tradable instrument contract.
 *
 * Shared immutable value object representing a tradable instrument contract.
 * Uses a private constructor with static factory methods.
 */
export class Contract {
  private constructor(
    readonly symbol: string,
    readonly secType: SecurityType,
    readonly exchange: string,
    readonly currency: string,
    readonly expiry: string | null,
    readonly strike: string | null,
    readonly right: string | null,
    readonly multiplier: number,
  ) {}

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  static stock(symbol: string): Contract {
    return new Contract(symbol, SecurityType.STOCK, 'US', 'USD', null, null, null, 1);
  }

  static cryptoPerp(symbol: string, exchange: string, currency: string): Contract {
    return new Contract(symbol, SecurityType.PERP, exchange, currency, null, null, null, 1);
  }

  static cryptoSpot(symbol: string, exchange: string, currency: string): Contract {
    return new Contract(symbol, SecurityType.CRYPTO, exchange, currency, null, null, null, 1);
  }

  // ---------------------------------------------------------------------------
  // fromString — heuristic parser
  // ---------------------------------------------------------------------------

  static fromString(input: string): Contract {
    if (!input || input.trim().length === 0) {
      throw new Error('Contract input must not be blank');
    }

    const trimmed = input.trim();

    // 1. Contains "-SWAP" → PERP (e.g. "BTC-USDT-SWAP")
    if (trimmed.includes('-SWAP')) {
      const parts = trimmed.split('-');
      const symbol = parts[0]!;
      const currency = parts[1]!;
      return new Contract(symbol, SecurityType.PERP, 'OKX', currency, null, null, null, 1);
    }

    // 2. Matches [A-Z]+-[A-Z]+-\d{6} → FUTURE with expiry (e.g. "BTC-USD-250328")
    if (DATED_FUTURE_PATTERN.test(trimmed)) {
      const parts = trimmed.split('-');
      const symbol = parts[0]!;
      const currency = parts[1]!;
      const dateStr = parts[2]!;
      const expiry = parseExpiryDate(dateStr);
      return new Contract(symbol, SecurityType.FUTURE, 'OKX', currency, expiry, null, null, 1);
    }

    // 3. Contains "/" → CRYPTO spot (e.g. "BTC/USD")
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/');
      const symbol = parts[0]!;
      const currency = parts[1]!;
      return new Contract(symbol, SecurityType.CRYPTO, '', currency, null, null, null, 1);
    }

    // 4. Contains "-" and both parts are 3+ letter currency codes
    if (trimmed.includes('-')) {
      const parts = trimmed.split('-');
      if (parts.length === 2) {
        const left = parts[0]!;
        const right = parts[1]!;
        if (left.length >= 3 && right.length >= 3) {
          // Both parts are fiat → FOREX
          if (FIAT_CURRENCIES.has(left) && FIAT_CURRENCIES.has(right)) {
            return new Contract(left, SecurityType.FOREX, '', right, null, null, null, 1);
          }
          // Otherwise CRYPTO spot
          return new Contract(left, SecurityType.CRYPTO, '', right, null, null, null, 1);
        }
      }
    }

    // 5. Default → STOCK
    return new Contract(trimmed, SecurityType.STOCK, 'US', 'USD', null, null, null, 1);
  }

  // ---------------------------------------------------------------------------
  // toEngineSymbol — converts to broker-native symbol format
  // ---------------------------------------------------------------------------

  toEngineSymbol(): string {
    switch (this.secType) {
      case SecurityType.STOCK:
        return this.symbol;
      case SecurityType.PERP:
        return `${this.symbol}-${this.currency}-SWAP`;
      case SecurityType.FUTURE:
        return `${this.symbol}-${this.currency}-${formatExpiryForEngine(this.expiry)}`;
      case SecurityType.CRYPTO:
        return `${this.symbol}/${this.currency}`;
      case SecurityType.FOREX:
        return `${this.symbol}/${this.currency}`;
      case SecurityType.OPTION:
        return `${this.symbol} ${this.currency} ${formatExpiryForEngine(this.expiry)} ${this.strike} ${this.right}`;
      default:
        return this.symbol;
    }
  }

  // ---------------------------------------------------------------------------
  // displayName — human-readable description
  // ---------------------------------------------------------------------------

  displayName(): string {
    switch (this.secType) {
      case SecurityType.STOCK:
        return `${this.symbol} (Stock)`;
      case SecurityType.PERP:
        return `${this.symbol}-${this.currency} Perp @${this.exchange}`;
      case SecurityType.CRYPTO:
        return `${this.symbol}/${this.currency} Spot @${this.exchange}`;
      case SecurityType.FUTURE:
        return `${this.symbol}-${this.currency} Future ${this.expiry}`;
      case SecurityType.FOREX:
        return `${this.symbol}/${this.currency} Forex`;
      case SecurityType.OPTION:
        return `${this.symbol} ${this.strike} ${this.right} ${this.expiry} Option`;
      default:
        return this.symbol;
    }
  }

  // ---------------------------------------------------------------------------
  // Equality — based on all canonical fields
  // ---------------------------------------------------------------------------

  equals(other: Contract): boolean {
    return (
      this.symbol === other.symbol &&
      this.secType === other.secType &&
      this.exchange === other.exchange &&
      this.currency === other.currency &&
      this.expiry === other.expiry &&
      this.strike === other.strike &&
      this.right === other.right &&
      this.multiplier === other.multiplier
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a 6-digit YYMMDD string into an ISO date string "20YY-MM-DD".
 * E.g. "250328" → "2025-03-28"
 */
function parseExpiryDate(yymmdd: string): string {
  const yy = yymmdd.substring(0, 2);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

/**
 * Format an ISO expiry date back to YYMMDD for engine symbols.
 * E.g. "2025-03-28" → "250328"
 */
function formatExpiryForEngine(expiry: string | null): string {
  if (!expiry) return '';
  // "2025-03-28" → remove dashes, drop century prefix
  return expiry.replace(/-/g, '').substring(2);
}
