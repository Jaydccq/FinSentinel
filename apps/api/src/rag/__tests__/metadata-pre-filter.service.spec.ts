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
    const r = s.buildFilter('q', 'colloquial', explicit, buildExtracted());
    expect(r.hardFilter).toEqual(explicit);
    expect(r.softFilter).toBeUndefined();
    expect(r.appliedMode).toBe('soft');
  });

  // ── P3.1: docType + timeRange routing (closes [RAG-TD-R4-06]) ───────────────

  it('mode=soft: high-confidence docType is routed into hardFilter.docType', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'exact_lookup', {}, buildExtracted({
      docType: { value: '10-K', confidence: 0.9 },
    }));
    expect(r.hardFilter.docType).toBe('10-K');
  });

  it('mode=soft: low-confidence docType is dropped (not routed, not softly)', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'exact_lookup', {}, buildExtracted({
      docType: { value: '10-K', confidence: 0.5 },
    }));
    expect(r.hardFilter.docType).toBeUndefined();
  });

  it('explicit caller-supplied docType wins over extracted', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'exact_lookup', { docType: '10-Q' }, buildExtracted({
      docType: { value: '10-K', confidence: 0.95 },
    }));
    expect(r.hardFilter.docType).toBe('10-Q');
  });

  it('mode=soft: high-confidence timeRange.after becomes hardFilter.afterDate (ISO yyyy-mm-dd)', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'factoid', {}, buildExtracted({
      timeRange: { after: new Date('2024-01-01T00:00:00.000Z'), confidence: 0.95 },
    }));
    expect(r.hardFilter.afterDate).toBe('2024-01-01');
  });

  it('mode=soft: low-confidence timeRange is dropped', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'factoid', {}, buildExtracted({
      timeRange: { after: new Date('2024-01-01T00:00:00.000Z'), confidence: 0.5 },
    }));
    expect(r.hardFilter.afterDate).toBeUndefined();
  });

  it('explicit caller-supplied afterDate wins over extracted timeRange', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'factoid', { afterDate: '2023-07-01' }, buildExtracted({
      timeRange: { after: new Date('2024-01-01T00:00:00.000Z'), confidence: 0.95 },
    }));
    expect(r.hardFilter.afterDate).toBe('2023-07-01');
  });

  it('timeRange without .after is ignored (only .after maps to afterDate today)', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'factoid', {}, buildExtracted({
      timeRange: { before: new Date('2024-12-31T00:00:00.000Z'), confidence: 0.95 },
    }));
    expect(r.hardFilter.afterDate).toBeUndefined();
  });

  it('mode=hard: docType and timeRange both promote into hardFilter', () => {
    const s = new MetadataPreFilterService({ mode: 'hard', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('AAPL 10-K FY2024', 'exact_lookup', {}, buildExtracted({
      tickers: [{ value: 'AAPL', confidence: 0.99 }],
      docType: { value: '10-K', confidence: 0.9 },
      timeRange: { after: new Date('2024-01-01T00:00:00.000Z'), confidence: 0.95 },
    }));
    expect(r.hardFilter).toMatchObject({
      docType: '10-K',
      afterDate: '2024-01-01',
      tickers: ['AAPL'],
    });
  });

  it('mode=off: extracted docType/timeRange are NOT routed (passthrough)', () => {
    const s = new MetadataPreFilterService({ mode: 'off', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'exact_lookup', {}, buildExtracted({
      docType: { value: '10-K', confidence: 0.95 },
      timeRange: { after: new Date('2024-01-01T00:00:00.000Z'), confidence: 0.95 },
    }));
    expect(r.hardFilter.docType).toBeUndefined();
    expect(r.hardFilter.afterDate).toBeUndefined();
    expect(r.appliedMode).toBe('off');
  });

  // ── P1-3: sector + region soft pushdown ──────────────────────────────

  it('soft mode: surfaces top-confidence sector into softFilter.sector', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'analytical', {}, buildExtracted({
      sectors: [
        { value: 'Healthcare', confidence: 0.4 },
        { value: 'Technology', confidence: 0.9 },
      ],
    }));
    expect(r.softFilter?.sector).toBe('Technology');
  });

  it('soft mode: surfaces top-confidence region into softFilter.regionId', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'analytical', {}, buildExtracted({
      regions: [{ value: 'US', confidence: 0.7 }],
    }));
    expect(r.softFilter?.regionId).toBe('US');
  });

  it('soft mode: empty sectors/regions → no sector/regionId keys in softFilter', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'analytical', {}, buildExtracted({}));
    expect(r.softFilter?.sector).toBeUndefined();
    expect(r.softFilter?.regionId).toBeUndefined();
  });

  it('hard mode: sector/region NOT surfaced via soft (suppressed by hard mode)', () => {
    const s = new MetadataPreFilterService({ mode: 'hard', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('q', 'analytical', {}, buildExtracted({
      sectors: [{ value: 'Technology', confidence: 0.9 }],
      regions: [{ value: 'US', confidence: 0.9 }],
    }));
    expect(r.softFilter).toBeUndefined();
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
