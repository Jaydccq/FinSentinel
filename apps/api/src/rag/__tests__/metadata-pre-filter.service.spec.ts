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
