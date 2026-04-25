// Pre-configured Decimal for shared trading-arithmetic boundaries.
// All consumers in `apps/api/src/trading/...` must use this re-export so that
// precision and rounding mode are uniform across paper/live brokers and
// wallet persistence. See docs/exec-plans/2026-04-24-decimal-money-migration.md
// (M1) for context.
import DecimalJs from 'decimal.js';

export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_EVEN,
});
export type DecimalValue = InstanceType<typeof Decimal>;

/**
 * Decimal-string regex: positive (non-zero), no sign, no exponent, integer
 * or fixed-point with ≤ 8 fraction digits. Rejects "0", "0.0", "-1", "1e5",
 * "NaN", "Infinity", and the empty string.
 */
export const decimalStringRegex = /^(?!0+(\.0+)?$)\d+(\.\d{1,8})?$/;
