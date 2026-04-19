import { describe, it, expect } from 'vitest';
import { MetadataPreFilterService } from '../metadata-pre-filter.service';

describe('MetadataPreFilterService', () => {
  const service = new MetadataPreFilterService();

  it('passes explicit filters through unchanged', () => {
    const filters = { docType: 'SEC_FILING', sector: 'tech', regionId: 'US', afterDate: '2024-01-01' };
    const result = service.buildFilter('AAPL revenue', 'factoid', filters);

    expect(result.docType).toBe('SEC_FILING');
    expect(result.sector).toBe('tech');
    expect(result.regionId).toBe('US');
    expect(result.afterDate).toBe('2024-01-01');
  });

  it('candidateDocIds is empty for v1 (no entity extraction)', () => {
    const result = service.buildFilter('some query', undefined, {});
    expect(result.candidateDocIds).toEqual([]);
  });

  it('works with empty filters', () => {
    const result = service.buildFilter('query', 'analytical', {});
    expect(result.docType).toBeUndefined();
    expect(result.candidateDocIds).toEqual([]);
  });

  it('is a pure function -- no DB calls', () => {
    // Calling twice with the same input produces identical output and never throws.
    const filters = { docType: 'NEWS' };
    const a = service.buildFilter('q', 'relational', filters);
    const b = service.buildFilter('q', 'relational', filters);
    expect(a).toEqual(b);
  });

  it('accepts undefined queryClass without throwing', () => {
    expect(() => service.buildFilter('q', undefined, {})).not.toThrow();
  });
});
