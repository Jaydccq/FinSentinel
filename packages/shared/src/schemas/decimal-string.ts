import { z } from 'zod';
import { decimalStringRegex } from '../money';

/**
 * Reusable Zod validator for decimal-string trading values (qty, amount,
 * percentNav, price). Accepts only positive fixed-point decimals with
 * ≤ 8 fraction digits — rejects scientific notation, NaN, Infinity, zero,
 * negative, and empty strings.
 */
export const decimalString = z
  .string()
  .regex(decimalStringRegex, 'must be a positive decimal with ≤ 8 fraction digits');
