import { Decimal } from '@finsentinel/shared';

/**
 * Normalize a broker-side numeric value (string, number, BigInt) to a
 * canonical decimal string.
 *
 * Why: broker SDKs (CCXT in particular) emit values as JS numbers, which
 * `String()`s into scientific notation for very small magnitudes
 * (e.g., `String(1e-8) === '1e-8'`). The `decimalString` Zod schema rejects
 * scientific notation, so without normalization a perfectly valid filled
 * order from a crypto venue would fail downstream validation.
 *
 * Returns:
 * - Canonical `Decimal.toFixed(8)` string for valid finite, non-negative
 *   inputs.
 * - `null` for empty / NaN / Infinity / negative / non-decimal-shaped
 *   inputs. Callers decide whether to throw or pass null through (e.g.,
 *   "filled qty unknown" is OK in some receipts, not in others).
 *
 * Constants pulled out so the helper is self-contained:
 * - 8 fraction digits matches `decimalStringRegex` and the wallet
 *   persistence convention shipped in M3.
 */

const FIXED_DIGITS = 8;

export function toDecimalString(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' && input.trim() === '') return null;

  let dec: InstanceType<typeof Decimal>;
  try {
    if (typeof input === 'bigint') {
      dec = new Decimal(input.toString());
    } else if (typeof input === 'number') {
      if (!Number.isFinite(input)) return null;
      dec = new Decimal(input);
    } else if (typeof input === 'string') {
      // Reject explicit scientific notation up front. Decimal.js parses it
      // happily, but the canonical-string contract for the API forbids it,
      // so we shouldn't silently convert (the broker's behavior would
      // become hard to audit).
      if (/[eE]/.test(input)) return null;
      dec = new Decimal(input);
    } else {
      return null;
    }
  } catch {
    return null;
  }

  if (!dec.isFinite()) return null;
  if (dec.isNegative()) return null;
  return dec.toFixed(FIXED_DIGITS);
}
