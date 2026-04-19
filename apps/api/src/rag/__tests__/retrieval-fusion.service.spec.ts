import { describe, it, expect } from 'vitest';
import { RetrievalFusionService, type RankedCandidate } from '../retrieval-fusion.service';

describe('RetrievalFusionService', () => {
  const service = new RetrievalFusionService();

  function candidates(...ids: string[]): RankedCandidate[] {
    return ids.map((id, i) => ({
      chunkId: id,
      sourceId: `src-${id}`,
      content: `content-${id}`,
      metadata: {},
      score: 1.0 - i * 0.1,
      lane: 'dense' as const,
    }));
  }

  it('merges two lanes via RRF, deduplicating by chunkId', () => {
    const dense = candidates('a', 'b', 'c');
    dense.forEach(c => c.lane = 'dense');
    const sparse = candidates('b', 'd', 'a');
    sparse.forEach(c => c.lane = 'sparse');

    const result = service.fuse([dense, sparse], 60);

    const ids = result.map(r => r.chunkId);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).toContain('d');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ranks items appearing in multiple lanes higher', () => {
    const dense = candidates('shared', 'dense-only');
    dense.forEach(c => c.lane = 'dense');
    const sparse = candidates('shared', 'sparse-only');
    sparse.forEach(c => c.lane = 'sparse');

    const result = service.fuse([dense, sparse], 60);
    expect(result[0]!.chunkId).toBe('shared');
  });

  it('returns empty array for empty input', () => {
    expect(service.fuse([], 60)).toEqual([]);
    expect(service.fuse([[]], 60)).toEqual([]);
  });

  it('tracks which lanes contributed to each candidate', () => {
    const dense = candidates('a');
    dense.forEach(c => c.lane = 'dense');
    const sparse = candidates('a');
    sparse.forEach(c => c.lane = 'sparse');

    const result = service.fuse([dense, sparse], 60);
    expect(result[0]!.lanes).toContain('dense');
    expect(result[0]!.lanes).toContain('sparse');
  });

  it('accumulates representationTypesSeen across multiple hits for same chunkId', () => {
    const canonical: RankedCandidate = {
      chunkId: 'c1', sourceId: 's1', content: 'x', metadata: {},
      score: 0.9, lane: 'dense', representationType: ['canonical'],
    };
    const contextual: RankedCandidate = {
      chunkId: 'c1', sourceId: 's1', content: 'x', metadata: {},
      score: 0.8, lane: 'dense', representationType: ['contextual_text'],
    };

    const result = service.fuse([[canonical, contextual]], 60);
    expect(result).toHaveLength(1);
    expect(result[0]!.representationTypesSeen).toContain('canonical');
    expect(result[0]!.representationTypesSeen).toContain('contextual_text');
  });

  it('accumulates variantKindsSeen across multiple variants for same chunkId', () => {
    const original: RankedCandidate = {
      chunkId: 'c1', sourceId: 's1', content: 'x', metadata: {},
      score: 0.9, lane: 'dense', variantKind: 'original',
    };
    const rewrite: RankedCandidate = {
      chunkId: 'c1', sourceId: 's1', content: 'x', metadata: {},
      score: 0.85, lane: 'dense', variantKind: 'rewrite',
    };

    const result = service.fuse([[original], [rewrite]], 60);
    expect(result).toHaveLength(1);
    expect(result[0]!.variantKindsSeen).toContain('original');
    expect(result[0]!.variantKindsSeen).toContain('rewrite');
  });

  it('deduplicates representationTypesSeen entries', () => {
    const a: RankedCandidate = {
      chunkId: 'c1', sourceId: 's1', content: 'x', metadata: {},
      score: 0.9, lane: 'dense', representationType: ['canonical'],
    };
    const b: RankedCandidate = {
      chunkId: 'c1', sourceId: 's1', content: 'x', metadata: {},
      score: 0.8, lane: 'sparse', representationType: ['canonical'],
    };

    const result = service.fuse([[a], [b]], 60);
    expect(result[0]!.representationTypesSeen.filter(t => t === 'canonical')).toHaveLength(1);
  });

  it('empty provenance fields when no variant/rep type set', () => {
    const cand = candidates('a');
    const result = service.fuse([cand], 60);
    expect(result[0]!.representationTypesSeen).toEqual([]);
    expect(result[0]!.variantKindsSeen).toEqual([]);
  });
});
