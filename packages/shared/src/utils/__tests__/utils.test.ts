import { describe, it, expect } from 'vitest';
import { sha256 } from '../hash';
import { toNumericString } from '../number';
import { fromTicker } from '../sector-mapper';

// ---------------------------------------------------------------------------
// HashUtils — sha256
// ---------------------------------------------------------------------------
describe('sha256', () => {
  it('returns a 7-character hex string', () => {
    const result = sha256('hello');
    expect(result).toHaveLength(7);
    expect(result).toMatch(/^[0-9a-f]{7}$/);
  });

  it('is deterministic (same input produces same output)', () => {
    expect(sha256('test-input')).toBe(sha256('test-input'));
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('abc')).not.toBe(sha256('def'));
  });

  it('handles empty string', () => {
    const result = sha256('');
    expect(result).toHaveLength(7);
    expect(result).toMatch(/^[0-9a-f]{7}$/);
  });

  it('matches known SHA-256 prefix for "hello"', () => {
    // SHA-256 of "hello" is 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256('hello')).toBe('2cf24db');
  });

  it('handles unicode strings', () => {
    const result = sha256('\u4f60\u597d');
    expect(result).toHaveLength(7);
    expect(result).toMatch(/^[0-9a-f]{7}$/);
  });
});

// ---------------------------------------------------------------------------
// NumberUtils — toNumericString
// ---------------------------------------------------------------------------
describe('toNumericString', () => {
  it('returns "0" for null', () => {
    expect(toNumericString(null)).toBe('0');
  });

  it('returns "0" for undefined', () => {
    expect(toNumericString(undefined)).toBe('0');
  });

  it('converts integer number to string', () => {
    expect(toNumericString(42)).toBe('42');
  });

  it('converts float number to string', () => {
    expect(toNumericString(3.14)).toBe('3.14');
  });

  it('converts zero to "0"', () => {
    expect(toNumericString(0)).toBe('0');
  });

  it('converts negative number to string', () => {
    expect(toNumericString(-99.5)).toBe('-99.5');
  });

  it('passes through numeric string as-is', () => {
    expect(toNumericString('99.99')).toBe('99.99');
  });

  it('passes through negative numeric string', () => {
    expect(toNumericString('-42.5')).toBe('-42.5');
  });

  it('passes through integer string', () => {
    expect(toNumericString('100')).toBe('100');
  });

  it('throws on non-numeric string', () => {
    expect(() => toNumericString('abc')).toThrow();
  });

  it('throws on mixed alphanumeric string', () => {
    expect(() => toNumericString('12abc')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => toNumericString('')).toThrow();
  });

  it('throws on whitespace-only string', () => {
    expect(() => toNumericString('   ')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SectorMapper — fromTicker
// ---------------------------------------------------------------------------
describe('fromTicker', () => {
  // Technology sector
  it.each([
    ['AAPL', 'Technology'],
    ['MSFT', 'Technology'],
    ['GOOGL', 'Technology'],
    ['META', 'Technology'],
    ['NVDA', 'Technology'],
    ['AMD', 'Technology'],
    ['INTC', 'Technology'],
    ['TSM', 'Technology'],
    ['AVGO', 'Technology'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Financials sector
  it.each([
    ['JPM', 'Financials'],
    ['BAC', 'Financials'],
    ['GS', 'Financials'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Healthcare sector
  it.each([
    ['JNJ', 'Healthcare'],
    ['PFE', 'Healthcare'],
    ['UNH', 'Healthcare'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Energy sector
  it.each([
    ['XOM', 'Energy'],
    ['CVX', 'Energy'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Consumer Discretionary sector
  it.each([
    ['AMZN', 'Consumer Discretionary'],
    ['WMT', 'Consumer Discretionary'],
    ['HD', 'Consumer Discretionary'],
    ['TSLA', 'Consumer Discretionary'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Consumer Staples sector
  it.each([
    ['PG', 'Consumer Staples'],
    ['KO', 'Consumer Staples'],
    ['PEP', 'Consumer Staples'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Utilities sector
  it.each([
    ['NEE', 'Utilities'],
    ['DUK', 'Utilities'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Real Estate sector
  it.each([
    ['PLD', 'Real Estate'],
    ['AMT', 'Real Estate'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Industrials sector
  it.each([
    ['LMT', 'Industrials'],
    ['BA', 'Industrials'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Communication Services sector
  it.each([
    ['T', 'Communication Services'],
    ['VZ', 'Communication Services'],
  ])('maps %s to %s', (ticker, sector) => {
    expect(fromTicker(ticker)).toBe(sector);
  });

  // Unknown tickers
  it('returns "Unknown" for unrecognized ticker', () => {
    expect(fromTicker('ZZZZ')).toBe('Unknown');
  });

  it('returns "Unknown" for random string', () => {
    expect(fromTicker('FOOBAR')).toBe('Unknown');
  });

  // Case insensitivity
  it('is case-insensitive', () => {
    expect(fromTicker('aapl')).toBe('Technology');
    expect(fromTicker('Aapl')).toBe('Technology');
    expect(fromTicker('jpm')).toBe('Financials');
  });
});
