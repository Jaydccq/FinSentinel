import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ContextExpanderService } from '../context-expander.service';
import type { RerankedCandidate } from '../rerank.service';

function makeConfigService(expansionEnabled = false, topN = 10) {
  return {
    get: vi.fn((key: string, defaultVal: unknown) => {
      if (key === 'RAG_CONTEXT_EXPANSION_ENABLED') return expansionEnabled ? 'true' : 'false';
      if (key === 'RAG_CONTEXT_EXPANSION_TOP_N') return topN;
      return defaultVal;
    }),
  };
}

function makeDb(queryResult: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(queryResult),
  };
}

function makeCandidate(
  partial: Partial<RerankedCandidate> & { chunkId: string },
): RerankedCandidate {
  return {
    sourceId: 'src-1',
    content: 'test content',
    metadata: { chunk_index: 0 },
    rrfScore: 0.05,
    lanes: ['dense'],
    representationTypesSeen: [],
    variantKindsSeen: [],
    rerankScore: 0.9,
    fallbackReason: null,
    ...partial,
  };
}

describe('ContextExpanderService — flag off', () => {
  it('returns input unchanged when expansion is disabled', async () => {
    const db = makeDb();
    const service = new ContextExpanderService(db as any, makeConfigService(false) as any);

    const candidates = [makeCandidate({ chunkId: 'c1' })];
    const result = await service.expand(candidates, { neighborChunks: 1, fetchParentSection: true });

    expect(result).toBe(candidates);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('ContextExpanderService — expansion enabled', () => {
  let db: { execute: Mock };
  let service: ContextExpanderService;

  beforeEach(() => {
    db = makeDb();
    service = new ContextExpanderService(db as any, makeConfigService(true, 10) as any);
  });

  it('returns input unchanged when DB returns empty expansion set', async () => {
    db.execute.mockResolvedValue([]);
    const candidates = [makeCandidate({ chunkId: 'c1', metadata: { chunk_index: 5, section_path: '2.3 FX' } })];
    const result = await service.expand(candidates, { neighborChunks: 1, fetchParentSection: true });

    // Original candidate still first, no expansion appended
    expect(result).toHaveLength(1);
    expect(result[0]!.chunkId).toBe('c1');
  });

  it('appends expanded neighbors after originals with 0.75x rerankScore', async () => {
    db.execute.mockResolvedValue([
      {
        id: 'c2',
        source_id: 'src-1',
        chunk_index: 6,
        content: 'neighbor content',
        metadata: {},
        meta_title: null,
        section_path: '2.3 FX',
        parent_id: null,
      },
    ]);

    const candidates = [
      makeCandidate({
        chunkId: 'c1',
        sourceId: 'src-1',
        rerankScore: 0.8,
        metadata: { chunk_index: 5, section_path: '2.3 FX' },
      }),
    ];

    const result = await service.expand(candidates, { neighborChunks: 1, fetchParentSection: true });

    expect(result).toHaveLength(2);
    expect(result[0]!.chunkId).toBe('c1');
    expect(result[1]!.chunkId).toBe('c2');
    expect(result[1]!.rerankScore).toBeCloseTo(0.8 * 0.75);
    expect(result[1]!.content).toBe('neighbor content');
  });

  it('deduplicates expanded chunks that already appear in the candidates list', async () => {
    db.execute.mockResolvedValue([
      {
        id: 'c1', // same as existing candidate — should be skipped
        source_id: 'src-1',
        chunk_index: 4,
        content: 'duplicate',
        metadata: {},
        meta_title: null,
        section_path: null,
        parent_id: null,
      },
    ]);

    const candidates = [makeCandidate({ chunkId: 'c1', metadata: { chunk_index: 5 } })];
    const result = await service.expand(candidates, { neighborChunks: 1, fetchParentSection: false });

    expect(result).toHaveLength(1);
  });

  it('falls back to chunk_index-only query when section_path is null', async () => {
    db.execute.mockResolvedValue([]);

    const candidates = [
      makeCandidate({ chunkId: 'c1', metadata: { chunk_index: 3 } }), // no section_path
    ];

    await service.expand(candidates, { neighborChunks: 1, fetchParentSection: true });

    // One DB call made (chunk_index window fallback)
    expect(db.execute).toHaveBeenCalledTimes(1);
    const query: string = String(db.execute.mock.calls[0]![0]);
    // Should NOT contain section_path filter
    expect(query).not.toContain('section_path');
  });

  it('uses section_path LIKE filter when section_path is present', async () => {
    db.execute.mockResolvedValue([]);

    const candidates = [
      makeCandidate({ chunkId: 'c1', metadata: { chunk_index: 2, section_path: '1.2 Risk' } }),
    ];

    await service.expand(candidates, { neighborChunks: 1, fetchParentSection: true });

    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('respects topN bound — only top-N candidates get expansion queries', async () => {
    const smallTopNService = new ContextExpanderService(
      db as any,
      makeConfigService(true, 2) as any,
    );
    db.execute.mockResolvedValue([]);

    // 4 candidates — only first 2 should be expanded
    const candidates = [
      makeCandidate({ chunkId: 'c1', metadata: { chunk_index: 1 } }),
      makeCandidate({ chunkId: 'c2', metadata: { chunk_index: 2 }, sourceId: 'src-2' }),
      makeCandidate({ chunkId: 'c3', metadata: { chunk_index: 3 }, sourceId: 'src-3' }),
      makeCandidate({ chunkId: 'c4', metadata: { chunk_index: 4 }, sourceId: 'src-4' }),
    ];

    await smallTopNService.expand(candidates, { neighborChunks: 1, fetchParentSection: false });

    // DB called twice (one per candidate in top-N=2)
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('skips candidates without chunk_index in metadata without throwing', async () => {
    const candidates = [
      makeCandidate({ chunkId: 'c1', metadata: {} }), // no chunk_index
    ];

    const result = await service.expand(candidates, { neighborChunks: 1, fetchParentSection: true });

    // No DB call, returns originals unchanged
    expect(db.execute).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('gracefully handles DB errors on a candidate without propagating', async () => {
    db.execute.mockRejectedValue(new Error('DB connection lost'));

    const candidates = [
      makeCandidate({ chunkId: 'c1', metadata: { chunk_index: 1 } }),
    ];

    // Should not throw
    const result = await service.expand(candidates, { neighborChunks: 1, fetchParentSection: false });
    expect(result).toHaveLength(1);
    expect(result[0]!.chunkId).toBe('c1');
  });

  it('assigns fallbackReason from the parent candidate to expanded chunks', async () => {
    db.execute.mockResolvedValue([
      {
        id: 'c2',
        source_id: 'src-1',
        chunk_index: 4,
        content: 'expanded',
        metadata: {},
        meta_title: null,
        section_path: null,
        parent_id: null,
      },
    ]);

    const candidates = [
      makeCandidate({ chunkId: 'c1', metadata: { chunk_index: 3 }, fallbackReason: 'rerank_malformed' }),
    ];

    const result = await service.expand(candidates, { neighborChunks: 1 });
    const expandedChunk = result.find((r) => r.chunkId === 'c2')!;
    expect(expandedChunk.fallbackReason).toBe('rerank_malformed');
  });
});
