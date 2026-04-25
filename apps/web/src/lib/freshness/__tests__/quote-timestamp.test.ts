/**
 * PL-7 quote-timestamp adapter tests. Pins seconds-vs-ms detection.
 */
import { describe, it, expect } from 'vitest';
import { normalizeQuoteTimestampMs } from '../quote-timestamp';

describe('normalizeQuoteTimestampMs', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeQuoteTimestampMs(null)).toBeNull();
    expect(normalizeQuoteTimestampMs(undefined)).toBeNull();
  });

  it('returns null for non-finite or non-positive values', () => {
    expect(normalizeQuoteTimestampMs(Number.NaN)).toBeNull();
    expect(normalizeQuoteTimestampMs(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeQuoteTimestampMs(0)).toBeNull();
    expect(normalizeQuoteTimestampMs(-1)).toBeNull();
  });

  it('passes ms-scale timestamps through unchanged', () => {
    const ms = Date.UTC(2026, 3, 25, 12, 0, 0);
    expect(normalizeQuoteTimestampMs(ms)).toBe(ms);
  });

  it('multiplies seconds-scale (FMP) timestamps by 1000', () => {
    const seconds = 1_700_000_000; // ~Nov 2023
    expect(normalizeQuoteTimestampMs(seconds)).toBe(seconds * 1000);
  });

  it('uses 1e12 as the seconds-vs-ms boundary', () => {
    // Just-below boundary: treated as seconds.
    expect(normalizeQuoteTimestampMs(9.99e11)).toBe(9.99e11 * 1000);
    // At boundary: treated as ms.
    expect(normalizeQuoteTimestampMs(1e12)).toBe(1e12);
  });
});
