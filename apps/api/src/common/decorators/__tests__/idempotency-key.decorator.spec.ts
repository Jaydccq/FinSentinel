import { describe, it, expect } from 'vitest';
import { extractIdempotencyKey } from '../idempotency-key.decorator';

describe('extractIdempotencyKey', () => {
  it('returns the Idempotency-Key header value', () => {
    const req = { headers: { 'idempotency-key': 'abc-123' } };
    expect(extractIdempotencyKey(req)).toBe('abc-123');
  });

  it('is case-insensitive', () => {
    const req = { headers: { 'Idempotency-Key': 'XYZ' } };
    expect(extractIdempotencyKey(req)).toBe('XYZ');
  });

  it('returns undefined when header absent', () => {
    expect(extractIdempotencyKey({ headers: {} })).toBeUndefined();
  });

  it('returns undefined when header is empty string', () => {
    expect(extractIdempotencyKey({ headers: { 'idempotency-key': '' } })).toBeUndefined();
  });

  it('takes first non-empty value when header is multi-valued', () => {
    const req = { headers: { 'idempotency-key': ['k1', 'k2'] } };
    expect(extractIdempotencyKey(req)).toBe('k1');
  });
});
