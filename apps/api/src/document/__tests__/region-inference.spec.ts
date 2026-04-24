import { describe, it, expect } from 'vitest';
import { resolveRegion } from '../region-inference';

describe('resolveRegion', () => {
  it('honors explicit regionId without inference', () => {
    expect(resolveRegion('10-K_AAPL_2024.pdf', 'EU')).toEqual({
      regionId: 'EU',
      inferredFrom: null,
    });
  });

  describe('filename heuristics (no explicit regionId)', () => {
    it.each([
      ['10-K_AAPL_2024.pdf', 'US', 'sec-filing-code'],
      ['TSM_10-Q_2024Q3.pdf', 'US', 'sec-filing-code'],
      ['s-1_filing.pdf', 'US', 'sec-filing-code'],
      ['DEF14A_proxy.pdf', 'US', 'sec-filing-code'],
      ['0700_HK_HKEX_annual_2024.pdf', 'HK', 'hkex-marker'],
      ['港交所_披露_0700.pdf', 'HK', 'hkex-marker'],
      ['贵州茅台_2024年度报告.pdf', 'CN', 'cn-report-zh'],
      ['中国平安_季报.pdf', 'CN', 'cn-report-zh'],
      ['MiFID_II_product_governance.pdf', 'EU', 'eu-mifid-esma'],
      ['Sony_EDINET_2024.pdf', 'JP', 'edinet-marker'],
      ['任天堂_有価証券報告書.pdf', 'JP', 'edinet-marker'],
    ])('infers region=%s from %s', (name, region, label) => {
      expect(resolveRegion(name, undefined)).toEqual({
        regionId: region,
        inferredFrom: label,
      });
    });
  });

  it("falls back to 'UNKNOWN' when no rule matches", () => {
    expect(resolveRegion('random_notes.txt', undefined)).toEqual({
      regionId: 'UNKNOWN',
      inferredFrom: null,
    });
  });

  it('prefers the first-matching rule (precedence ordering)', () => {
    // SEC-filing + HKEX marker in the same filename — US wins because the
    // SEC code is strongest.
    expect(resolveRegion('HKEX_10-K_weird.pdf', undefined).regionId).toBe('US');
  });
});
