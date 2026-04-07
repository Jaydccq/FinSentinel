import { describe, it, expect } from 'vitest';
import { ContextPackerService } from '../context-packer.service';

describe('ContextPackerService', () => {
  const service = new ContextPackerService();

  function candidate(chunkId: string, sourceId: string, content: string) {
    return {
      chunkId,
      sourceId,
      content,
      metadata: {},
      rrfScore: 0.5,
      lanes: ['dense'],
      rerankScore: 0.9,
    };
  }

  it('enforces source diversity: max 3 chunks per source', () => {
    const candidates = [
      candidate('c1', 'doc-A', 'chunk 1 from A'),
      candidate('c2', 'doc-A', 'chunk 2 from A'),
      candidate('c3', 'doc-A', 'chunk 3 from A'),
      candidate('c4', 'doc-A', 'chunk 4 from A - should be dropped'),
      candidate('c5', 'doc-B', 'chunk 1 from B'),
    ];

    const result = service.pack(candidates, { maxChunksPerSource: 3, maxTokens: 100000 });
    const fromA = result.chunks.filter((c) => c.sourceId === 'doc-A');
    expect(fromA).toHaveLength(3);
    expect(result.chunks).toHaveLength(4);
  });

  it('respects token budget', () => {
    const longContent = 'word '.repeat(2000);
    const candidates = [
      candidate('c1', 'doc-A', longContent),
      candidate('c2', 'doc-B', longContent),
      candidate('c3', 'doc-C', longContent),
    ];

    const result = service.pack(candidates, { maxTokens: 3000 });
    expect(result.chunks.length).toBeLessThan(3);
    expect(result.totalTokenEstimate).toBeLessThanOrEqual(3000);
  });

  it('deduplicates by chunkId', () => {
    const candidates = [
      candidate('c1', 'doc-A', 'same chunk'),
      candidate('c1', 'doc-A', 'same chunk'),
      candidate('c2', 'doc-B', 'different'),
    ];

    const result = service.pack(candidates);
    expect(result.chunks).toHaveLength(2);
  });

  it('preserves provenance on each chunk', () => {
    const candidates = [candidate('c1', 'doc-A', 'test content')];
    const result = service.pack(candidates);
    expect(result.chunks[0]).toHaveProperty('sourceId', 'doc-A');
    expect(result.chunks[0]).toHaveProperty('chunkId', 'c1');
  });
});
