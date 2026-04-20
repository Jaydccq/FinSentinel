import { describe, it, expect } from 'vitest';
import { MetadataPreFilterService } from '../metadata-pre-filter.service';
import type { ExtractedEntities } from '../query-entity-extractor.service';

const buildExtracted = (overrides: Partial<ExtractedEntities> = {}): ExtractedEntities => ({
  tickers: [],
  issuerNames: [],
  sectors: [],
  regions: [],
  ...overrides,
});

describe('MetadataPreFilterService.buildFilter (R4.2)', () => {
  const explicit = { docType: 'SEC_FILING' };

  it('mode=off: hardFilter is explicit only; softFilter undefined', () => {
    const s = new MetadataPreFilterService({ mode: 'off', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'exact_lookup', explicit, buildExtracted({
      tickers: [{ value: 'AAPL', confidence: 0.95 }],
    }));
    expect(r.hardFilter).toEqual(explicit);
    expect(r.softFilter).toBeUndefined();
    expect(r.appliedMode).toBe('off');
    expect(r.candidateDocIds).toEqual([]);
  });

  it('mode=off: handles null extracted gracefully', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'factoid', explicit, null);
    expect(r.hardFilter).toEqual(explicit);
    expect(r.softFilter).toBeUndefined();
    expect(r.appliedMode).toBe('off');
  });

  it('mode=hard: promotes high-confidence tickers into hardFilter; softFilter stays undefined', () => {
    const s = new MetadataPreFilterService({ mode: 'hard', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'exact_lookup', explicit, buildExtracted({
      tickers: [{ value: 'AAPL', confidence: 0.95 }, { value: 'LOW', confidence: 0.5 }],
    }));
    expect(r.hardFilter).toMatchObject({ ...explicit, tickers: ['AAPL'] });
    expect(r.softFilter).toBeUndefined();
    expect(r.appliedMode).toBe('hard');
  });

  it('mode=soft: low-confidence issuerNames go into softFilter, high-confidence into hardFilter', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'factoid', explicit, buildExtracted({
      issuerNames: [{ value: 'Nvidia', confidence: 0.7 }, { value: 'Apple Inc.', confidence: 0.9 }],
    }));
    expect(r.hardFilter).toMatchObject({ ...explicit, issuerName: ['Apple Inc.'] });
    expect(r.softFilter?.issuerName).toEqual(['Nvidia']);
    expect(r.appliedMode).toBe('soft');
  });

  it('mode=soft: all-high-confidence extraction leaves softFilter undefined', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'exact_lookup', explicit, buildExtracted({
      tickers: [{ value: 'AAPL', confidence: 0.95 }],
    }));
    expect(r.hardFilter).toMatchObject({ ...explicit, tickers: ['AAPL'] });
    expect(r.softFilter).toBeUndefined();
    expect(r.appliedMode).toBe('soft');
  });

  it('mode=soft: empty extracted yields hardFilter == explicit, softFilter undefined, appliedMode = soft', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    // FIXME(R4): plan uses 'colloquial' but QueryClass omits it; reconcile in a follow-up.
    const r = s.buildFilter('q', 'colloquial' as any, explicit, buildExtracted());
    expect(r.hardFilter).toEqual(explicit);
    expect(r.softFilter).toBeUndefined();
    expect(r.appliedMode).toBe('soft');
  });
});

describe('MetadataPreFilterService.shouldDowngrade', () => {
  const makeSvc = (cfg: Partial<import('../metadata-pre-filter.service').PreFilterConfig> = {}) =>
    new MetadataPreFilterService({
      mode: 'soft',
      hardMinConfidence: 0.85,
      minCandidatesByClass: { exact_lookup: 5, analytical: 30 },
      ...cfg,
    });

  it('returns false when queryClass is undefined', () => {
    const svc = makeSvc();
    expect(svc.shouldDowngrade(undefined, 2, true)).toBe(false);
  });

  it('returns false when hardFilterHadHints is false', () => {
    const svc = makeSvc();
    expect(svc.shouldDowngrade('analytical', 2, false)).toBe(false);
  });

  it('returns false when candidate count meets threshold', () => {
    const svc = makeSvc();
    expect(svc.shouldDowngrade('analytical', 30, true)).toBe(false);
    expect(svc.shouldDowngrade('analytical', 31, true)).toBe(false);
  });

  it('returns true when candidate count is below threshold', () => {
    const svc = makeSvc();
    expect(svc.shouldDowngrade('analytical', 29, true)).toBe(true);
    expect(svc.shouldDowngrade('exact_lookup', 2, true)).toBe(true);
  });

  it('returns false when the queryClass has no threshold configured', () => {
    const svc = makeSvc({ minCandidatesByClass: {} });
    expect(svc.shouldDowngrade('exact_lookup', 0, true)).toBe(false);
  });
});
