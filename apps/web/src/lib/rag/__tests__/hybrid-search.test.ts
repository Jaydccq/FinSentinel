import { describe, it, expect, vi } from 'vitest';
import { hybridSearch } from '../hybrid-search';

describe('hybridSearch', () => {
  it('merges and tags results from both sources', async () => {
    const cloud = vi.fn().mockResolvedValue([
      { id: 'c1', content: 'cloud snippet', score: 0.9 },
    ]);
    const local = vi.fn().mockResolvedValue([
      { chunk_id: 'l1', file_name: 'notes.pdf', content: 'local snippet', distance: 0.2, document_id: 'd1' },
    ]);

    const out = await hybridSearch({
      query: 'q', topK: 5, cloudSearch: cloud, localSearch: local, localAvailable: true,
    });

    expect(cloud).toHaveBeenCalledWith('q', 5);
    expect(local).toHaveBeenCalledWith('q', 5);
    expect(out).toHaveLength(2);
    expect(out.find((h) => h.provenance === 'cloud')).toBeDefined();
    expect(out.find((h) => h.provenance === 'local')).toBeDefined();
  });

  it('returns only cloud results when local unavailable', async () => {
    const cloud = vi.fn().mockResolvedValue([{ id: 'c1', content: 'x', score: 0.9 }]);
    const local = vi.fn();

    const out = await hybridSearch({
      query: 'q', topK: 5, cloudSearch: cloud, localSearch: local, localAvailable: false,
    });

    expect(local).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].provenance).toBe('cloud');
  });

  it('survives local path failure', async () => {
    const cloud = vi.fn().mockResolvedValue([{ id: 'c1', content: 'x', score: 0.9 }]);
    const local = vi.fn().mockRejectedValue(new Error('sqlite down'));

    const out = await hybridSearch({
      query: 'q', topK: 5, cloudSearch: cloud, localSearch: local, localAvailable: true,
    });

    expect(out).toHaveLength(1);
    expect(out[0].provenance).toBe('cloud');
  });

  it('sorts by normalized score descending', async () => {
    const cloud = vi.fn().mockResolvedValue([{ id: 'c1', content: 'a', score: 0.5 }]);
    const local = vi.fn().mockResolvedValue([
      { chunk_id: 'l1', file_name: 'n.pdf', content: 'b', distance: 0.1, document_id: 'd1' },
    ]);

    const out = await hybridSearch({
      query: 'q', topK: 5, cloudSearch: cloud, localSearch: local, localAvailable: true,
    });

    expect(out[0].provenance).toBe('local');
  });
});
