import { describe, it, expect } from 'vitest';
import { SecurityType, isCrypto } from '../security-type';

describe('SecurityType', () => {
  it('has exactly 6 values', () => {
    expect(Object.values(SecurityType)).toHaveLength(6);
  });

  it('contains all security types', () => {
    expect(SecurityType.STOCK).toBe('STOCK');
    expect(SecurityType.OPTION).toBe('OPTION');
    expect(SecurityType.FUTURE).toBe('FUTURE');
    expect(SecurityType.CRYPTO).toBe('CRYPTO');
    expect(SecurityType.PERP).toBe('PERP');
    expect(SecurityType.FOREX).toBe('FOREX');
  });

  describe('isCrypto', () => {
    it('returns true for CRYPTO', () => {
      expect(isCrypto(SecurityType.CRYPTO)).toBe(true);
    });

    it('returns true for PERP', () => {
      expect(isCrypto(SecurityType.PERP)).toBe(true);
    });

    it('returns false for STOCK', () => {
      expect(isCrypto(SecurityType.STOCK)).toBe(false);
    });

    it('returns false for OPTION', () => {
      expect(isCrypto(SecurityType.OPTION)).toBe(false);
    });

    it('returns false for FUTURE', () => {
      expect(isCrypto(SecurityType.FUTURE)).toBe(false);
    });

    it('returns false for FOREX', () => {
      expect(isCrypto(SecurityType.FOREX)).toBe(false);
    });
  });
});
