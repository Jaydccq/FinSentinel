import { describe, it, expect, vi } from 'vitest';
import { hybridSearch } from '../hybrid-search';
import type { HybridHit, CloudHit } from '../hybrid-search';
import type { SearchHit } from '../../tauri/private-docs';

// ---------------------------------------------------------------------------
// Type-level backward-compatibility assertion.
// If HybridHit ever drops a required field this compile-time check will fail.
// ---------------------------------------------------------------------------
function assertHybridHitShape(h: HybridHit): void {
  const _id: string = h.id;
  const _content: string = h.content;
  const _score: number = h.score;
  const _provenance: 'local' | 'cloud' = h.provenance;
  const _raw: CloudHit | SearchHit = h.raw;
  void _id;
  void _content;
  void _score;
  void _provenance;
  void _raw;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseCloudHit: CloudHit = { id: 'c1', content: 'cloud snippet', score: 0.9 };

// A CloudHit as it looks after T2-T5: carries extra optional fields.
const richCloudHit: CloudHit = {
  id: 'c2',
  content: 'rich cloud snippet',
  score: 0.85,
  chunkId: 'ck-abc123',
  sourceId: 'src-xyz',
  representationTypesSeen: ['contextual_text', 'sample_question'],
  variantKindsSeen: ['rewrite', 'hyde'],
  fallbackReason: null,
};

const baseLocalHit: SearchHit = {
  chunk_id: 'l1',
  document_id: 'd1',
  file_name: 'notes.pdf',
  content: 'local snippet',
  distance: 0.2,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hybridSearch', () => {
  it('merges and tags results from both sources', async () => {
    const cloud = vi.fn().mockResolvedValue([baseCloudHit]);
    const local = vi.fn().mockResolvedValue([baseLocalHit]);

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: true,
    });

    expect(cloud).toHaveBeenCalledWith('q', 5);
    expect(local).toHaveBeenCalledWith('q', 5);
    expect(out).toHaveLength(2);
    expect(out.find((h) => h.provenance === 'cloud')).toBeDefined();
    expect(out.find((h) => h.provenance === 'local')).toBeDefined();
    out.forEach(assertHybridHitShape);
  });

  it('returns only cloud results when local unavailable', async () => {
    const cloud = vi.fn().mockResolvedValue([baseCloudHit]);
    const local = vi.fn();

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: false,
    });

    expect(local).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].provenance).toBe('cloud');
    out.forEach(assertHybridHitShape);
  });

  it('survives local path failure', async () => {
    const cloud = vi.fn().mockResolvedValue([baseCloudHit]);
    const local = vi.fn().mockRejectedValue(new Error('sqlite down'));

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: true,
    });

    expect(out).toHaveLength(1);
    expect(out[0].provenance).toBe('cloud');
  });

  it('sorts by normalized score descending', async () => {
    // local distance 0.1 => sim 0.9, cloud score 0.5 => local should sort first
    const cloud = vi.fn().mockResolvedValue([{ id: 'c1', content: 'a', score: 0.5 }]);
    const local = vi
      .fn()
      .mockResolvedValue([
        { chunk_id: 'l1', file_name: 'n.pdf', content: 'b', distance: 0.1, document_id: 'd1' },
      ]);

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: true,
    });

    expect(out[0].provenance).toBe('local');
  });

  // -------------------------------------------------------------------------
  // NEW: Cloud hit carries T2-T5 extra fields
  // -------------------------------------------------------------------------

  it('preserves extra T-series cloud fields on HybridHit.raw', async () => {
    const cloud = vi.fn().mockResolvedValue([richCloudHit]);
    const local = vi.fn().mockResolvedValue([]);

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: true,
    });

    expect(out).toHaveLength(1);
    const hit = out[0];

    // canonical id field still used for HybridHit.id
    expect(hit.id).toBe('c2');
    // full raw payload including extra fields is preserved
    expect(hit.raw).toEqual(richCloudHit);
    expect((hit.raw as CloudHit).chunkId).toBe('ck-abc123');
    expect((hit.raw as CloudHit).sourceId).toBe('src-xyz');
    expect((hit.raw as CloudHit).representationTypesSeen).toEqual([
      'contextual_text',
      'sample_question',
    ]);
    expect((hit.raw as CloudHit).variantKindsSeen).toEqual(['rewrite', 'hyde']);
    expect((hit.raw as CloudHit).fallbackReason).toBeNull();
    // score unaffected
    expect(hit.score).toBe(0.85);
    expect(hit.provenance).toBe('cloud');
    assertHybridHitShape(hit);
  });

  // -------------------------------------------------------------------------
  // NEW: Local hits are valid under the new cloud shape
  // -------------------------------------------------------------------------

  it('merges local SearchHit without new cloud fields cleanly', async () => {
    const cloud = vi.fn().mockResolvedValue([]);
    const local = vi.fn().mockResolvedValue([baseLocalHit]);

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: true,
    });

    expect(out).toHaveLength(1);
    const hit = out[0];
    expect(hit.provenance).toBe('local');
    expect(hit.id).toBe('l1');
    // distance 0.2 => score 0.8
    expect(hit.score).toBeCloseTo(0.8);
    // raw is the original SearchHit — no extra cloud fields
    expect(hit.raw).toEqual(baseLocalHit);
    expect((hit.raw as SearchHit).chunk_id).toBe('l1');
    assertHybridHitShape(hit);
  });

  // -------------------------------------------------------------------------
  // NEW: Mixed-score sort stability with rich cloud + local
  // -------------------------------------------------------------------------

  it('sorts local hit above cloud hit when local score is higher despite extra cloud fields', async () => {
    // local distance 0.1 => sim 0.90; richCloudHit.score = 0.85 => local first
    const cloud = vi.fn().mockResolvedValue([richCloudHit]);
    const local = vi
      .fn()
      .mockResolvedValue([
        { chunk_id: 'l1', document_id: 'd1', file_name: 'n.pdf', content: 'local', distance: 0.1 },
      ]);

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: true,
    });

    expect(out).toHaveLength(2);
    expect(out[0].provenance).toBe('local');
    expect(out[0].score).toBeCloseTo(0.9);
    expect(out[1].provenance).toBe('cloud');
    expect(out[1].score).toBe(0.85);
  });

  // -------------------------------------------------------------------------
  // NEW: Cloud failure isolation
  // -------------------------------------------------------------------------

  it('returns only local hits when cloudSearch throws; no uncaught rejection', async () => {
    const cloud = vi.fn().mockRejectedValue(new Error('network error'));
    const local = vi.fn().mockResolvedValue([baseLocalHit]);

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: true,
    });

    expect(out).toHaveLength(1);
    expect(out[0].provenance).toBe('local');
    expect(out[0].id).toBe('l1');
  });

  // -------------------------------------------------------------------------
  // NEW: localAvailable: false skips localSearch entirely
  // -------------------------------------------------------------------------

  it('does not call localSearch when localAvailable is false', async () => {
    const cloud = vi.fn().mockResolvedValue([richCloudHit]);
    const local = vi.fn();

    const out = await hybridSearch({
      query: 'q',
      topK: 5,
      cloudSearch: cloud,
      localSearch: local,
      localAvailable: false,
    });

    expect(local).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].provenance).toBe('cloud');
    // extra fields still reachable through raw
    expect((out[0].raw as CloudHit).chunkId).toBe('ck-abc123');
  });
});
