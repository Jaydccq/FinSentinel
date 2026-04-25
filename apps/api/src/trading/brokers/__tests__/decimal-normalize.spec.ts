import { describe, it, expect } from 'vitest';
import { toDecimalString } from '../decimal-normalize';

describe('toDecimalString', () => {
  it('returns canonical .toFixed(8) for plain decimal strings', () => {
    expect(toDecimalString('100')).toBe('100.00000000');
    expect(toDecimalString('100.5')).toBe('100.50000000');
    expect(toDecimalString('100.12345678')).toBe('100.12345678');
  });

  it('returns canonical .toFixed(8) for finite numbers', () => {
    expect(toDecimalString(100)).toBe('100.00000000');
    expect(toDecimalString(0.1)).toBe('0.10000000');
  });

  it('handles BigInt', () => {
    expect(toDecimalString(123n)).toBe('123.00000000');
    expect(toDecimalString(0n)).toBe('0.00000000');
  });

  it('rejects scientific notation strings (broker shouldn\'t emit them, fail loudly)', () => {
    expect(toDecimalString('1e-8')).toBeNull();
    expect(toDecimalString('1E-8')).toBeNull();
    expect(toDecimalString('1.5e10')).toBeNull();
  });

  it('rejects empty string and whitespace', () => {
    expect(toDecimalString('')).toBeNull();
    expect(toDecimalString('   ')).toBeNull();
  });

  it('rejects NaN and Infinity', () => {
    expect(toDecimalString(NaN)).toBeNull();
    expect(toDecimalString(Infinity)).toBeNull();
    expect(toDecimalString(-Infinity)).toBeNull();
  });

  it('rejects negative inputs', () => {
    expect(toDecimalString('-1')).toBeNull();
    expect(toDecimalString(-1)).toBeNull();
    expect(toDecimalString('-0.5')).toBeNull();
  });

  it('rejects null / undefined / non-numeric types', () => {
    expect(toDecimalString(null)).toBeNull();
    expect(toDecimalString(undefined)).toBeNull();
    expect(toDecimalString({})).toBeNull();
    expect(toDecimalString([])).toBeNull();
  });

  it('rejects non-numeric strings', () => {
    expect(toDecimalString('abc')).toBeNull();
    expect(toDecimalString('1.2.3')).toBeNull();
  });

  it('accepts zero (downstream decimalString may reject; helper is just normalization)', () => {
    expect(toDecimalString('0')).toBe('0.00000000');
    expect(toDecimalString(0)).toBe('0.00000000');
  });

  it('preserves precision past JS number resolution for string input', () => {
    // A value with 8 frac digits that JS Number can't round-trip exactly:
    // 99999999.99999999 → as Number drifts; as a string we keep it byte-exact.
    expect(toDecimalString('99999999.99999999')).toBe('99999999.99999999');
  });

  it('does not introduce scientific notation in output for tiny inputs', () => {
    // 1e-8 as a number stringifies to '1e-8' via String(), but Decimal's
    // .toFixed(8) keeps it positional.
    expect(toDecimalString('0.00000001')).toBe('0.00000001');
  });
});
