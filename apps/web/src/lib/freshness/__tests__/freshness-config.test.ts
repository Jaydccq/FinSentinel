/**
 * PL-7 freshness badge config — sanity tests.
 * Verifies all four surfaces are present and that windows are sane:
 *   - both windows positive
 *   - staleWindowMs > freshWindowMs
 */
import { describe, it, expect } from 'vitest';
import {
  FRESHNESS_THRESHOLDS,
  type FreshnessSurface,
} from '../freshness-config';

const SURFACES: FreshnessSurface[] = ['quote', 'news', 'citation', 'holdings'];

describe('FRESHNESS_THRESHOLDS', () => {
  it('defines thresholds for all four surfaces', () => {
    for (const surface of SURFACES) {
      expect(FRESHNESS_THRESHOLDS[surface]).toBeDefined();
    }
  });

  it('keeps windows positive and stale > fresh on every surface', () => {
    for (const surface of SURFACES) {
      const t = FRESHNESS_THRESHOLDS[surface];
      expect(t.freshWindowMs).toBeGreaterThan(0);
      expect(t.staleWindowMs).toBeGreaterThan(0);
      expect(t.staleWindowMs).toBeGreaterThan(t.freshWindowMs);
    }
  });
});
