import { describe, it, expect } from 'vitest';
import { decimalOrderDraftSchema } from '../schemas/order-draft';
import { decimalString } from '../schemas/decimal-string';

describe('decimalString validator', () => {
  it('accepts a plain integer string', () => {
    expect(decimalString.parse('100')).toBe('100');
  });

  it('accepts a fixed-point decimal at the 8-fraction-digit boundary', () => {
    expect(decimalString.parse('100.12345678')).toBe('100.12345678');
  });

  it('rejects "0"', () => {
    expect(() => decimalString.parse('0')).toThrow();
  });

  it('rejects "0.0"', () => {
    expect(() => decimalString.parse('0.0')).toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => decimalString.parse('-1')).toThrow();
  });

  it('rejects the empty string', () => {
    expect(() => decimalString.parse('')).toThrow();
  });

  it('rejects "NaN"', () => {
    expect(() => decimalString.parse('NaN')).toThrow();
  });

  it('rejects "Infinity"', () => {
    expect(() => decimalString.parse('Infinity')).toThrow();
  });

  it('rejects scientific notation', () => {
    expect(() => decimalString.parse('1e5')).toThrow();
  });

  it('rejects > 8 fraction digits', () => {
    expect(() => decimalString.parse('100.123456789')).toThrow();
  });
});

describe('decimalOrderDraftSchema mutual exclusion', () => {
  const base = { symbol: 'AAPL', side: 'BUY' as const };

  it('accepts when only qty is set', () => {
    expect(
      decimalOrderDraftSchema.parse({ ...base, qty: '100' }),
    ).toMatchObject({ qty: '100' });
  });

  it('accepts when only amount is set', () => {
    expect(
      decimalOrderDraftSchema.parse({ ...base, amount: '1000' }),
    ).toMatchObject({ amount: '1000' });
  });

  it('accepts when only percentNav is set', () => {
    expect(
      decimalOrderDraftSchema.parse({ ...base, percentNav: '5' }),
    ).toMatchObject({ percentNav: '5' });
  });

  it('accepts price set alongside qty (limit order)', () => {
    expect(
      decimalOrderDraftSchema.parse({ ...base, qty: '100', price: '150.25' }),
    ).toMatchObject({ qty: '100', price: '150.25' });
  });

  it('accepts price set alongside amount', () => {
    expect(
      decimalOrderDraftSchema.parse({ ...base, amount: '1000', price: '150.25' }),
    ).toMatchObject({ amount: '1000', price: '150.25' });
  });

  it('accepts price set alongside percentNav', () => {
    expect(
      decimalOrderDraftSchema.parse({ ...base, percentNav: '5', price: '150.25' }),
    ).toMatchObject({ percentNav: '5', price: '150.25' });
  });

  it('rejects when qty AND amount are both set', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, qty: '100', amount: '1000' }),
    ).toThrow(/exactly one/);
  });

  it('rejects when qty AND percentNav are both set', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, qty: '100', percentNav: '5' }),
    ).toThrow(/exactly one/);
  });

  it('rejects when amount AND percentNav are both set', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, amount: '1000', percentNav: '5' }),
    ).toThrow(/exactly one/);
  });

  it('rejects when all three of qty/amount/percentNav are set', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({
        ...base,
        qty: '100',
        amount: '1000',
        percentNav: '5',
      }),
    ).toThrow(/exactly one/);
  });

  it('rejects when none of qty/amount/percentNav are set', () => {
    expect(() => decimalOrderDraftSchema.parse({ ...base })).toThrow(/exactly one/);
  });

  it('rejects when only price is set (no quantity dimension)', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, price: '150.25' }),
    ).toThrow(/exactly one/);
  });
});

describe('decimalOrderDraftSchema field-level validation', () => {
  const base = { symbol: 'AAPL', side: 'BUY' as const };

  it('rejects qty with > 8 fraction digits', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, qty: '100.123456789' }),
    ).toThrow();
  });

  it('rejects qty = "0"', () => {
    expect(() => decimalOrderDraftSchema.parse({ ...base, qty: '0' })).toThrow();
  });

  it('rejects negative qty', () => {
    expect(() => decimalOrderDraftSchema.parse({ ...base, qty: '-1' })).toThrow();
  });

  it('rejects scientific-notation amount', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, amount: '1e5' }),
    ).toThrow();
  });

  it('rejects "NaN" percentNav', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, percentNav: 'NaN' }),
    ).toThrow();
  });

  it('rejects "Infinity" price (when otherwise-valid quantity is set)', () => {
    expect(() =>
      decimalOrderDraftSchema.parse({ ...base, qty: '100', price: 'Infinity' }),
    ).toThrow();
  });
});
