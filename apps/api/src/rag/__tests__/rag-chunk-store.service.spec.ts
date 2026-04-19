import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { RagChunkStoreService } from '../rag-chunk-store.service';

function makeDb() {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const executeFn = vi.fn().mockResolvedValue([]);

  return {
    delete: deleteFn,
    insert: insertFn,
    execute: executeFn,
    _deleteWhere: deleteWhere,
    _insertValues: insertValues,
  };
}

describe('RagChunkStoreService', () => {
  let service: RagChunkStoreService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();

    const module = await Test.createTestingModule({
      providers: [
        RagChunkStoreService,
        { provide: 'DRIZZLE_DB', useValue: db },
      ],
    }).compile();

    service = module.get(RagChunkStoreService);
  });

  describe('replaceChunks', () => {
    it('deletes existing chunks for the (sourceType, sourceId) pair before inserting', async () => {
      await service.replaceChunks('document', 'doc-uuid-1', [
        { content: 'hello', embedding: [0.1, 0.2], metadata: { title: 'T' } },
      ]);

      expect(db.delete).toHaveBeenCalledOnce();
      expect(db._deleteWhere).toHaveBeenCalledOnce();
    });

    it('inserts the correct number of rows with required columns set', async () => {
      const chunks = [
        { content: 'chunk A', embedding: [1, 0], metadata: { title: 'Report', source: 'SEC' } },
        { content: 'chunk B', embedding: [0, 1], metadata: {} },
      ];

      await service.replaceChunks('news', 'news-uuid-1', chunks);

      expect(db._insertValues).toHaveBeenCalledOnce();
      const rows = (db._insertValues as Mock).mock.calls[0][0] as Record<string, unknown>[];
      expect(rows).toHaveLength(2);

      for (const row of rows) {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('parentId', null);
        expect(row).toHaveProperty('sectionPath', null);
        expect(row).toHaveProperty('enrichmentStatus', 'pending');
      }
    });

    it('skips INSERT and returns early when chunks array is empty', async () => {
      await service.replaceChunks('document', 'doc-uuid-2', []);

      expect(db.delete).toHaveBeenCalledOnce();
      expect(db._insertValues).not.toHaveBeenCalled();
    });

    it('CASCADE: deleting chunks removes representation rows (behavior contract)', async () => {
      // The SQL migration declares document_chunk_representations.chunk_id
      // REFERENCES document_chunks(id) ON DELETE CASCADE, so the DB will
      // automatically remove representation rows when their parent chunk is deleted.
      // This test asserts the delete is called unconditionally (the precondition for
      // CASCADE to fire) and that no explicit representation delete is issued by
      // replaceChunks itself -- the service intentionally delegates cleanup to the DB.
      const chunksWithRepresentations = [
        { content: 'original', embedding: [1, 0], metadata: {} },
      ];

      await service.replaceChunks('document', 'doc-with-reps', chunksWithRepresentations);

      // Exactly one delete call: the chunk delete that triggers CASCADE in Postgres
      expect(db.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchRepresentations', () => {
    it('returns canonical hits from document_chunks', async () => {
      db.execute.mockResolvedValueOnce([
        { chunk_id: 'c1', source_id: 's1', content: 'canon', metadata: {}, similarity: 0.9 },
      ]);
      // Rep type sub-queries return empty
      db.execute.mockResolvedValue([]);

      const results = await service.searchRepresentations([0.1, 0.2], {}, 5, ['canonical']);
      expect(results).toHaveLength(1);
      expect(results[0]!.chunkId).toBe('c1');
      expect(results[0]!.representationType).toBe('canonical');
    });

    it('returns contextual_text hits from document_chunk_representations', async () => {
      // canonical returns empty, contextual_text returns one hit
      db.execute
        .mockResolvedValueOnce([]) // canonical
        .mockResolvedValueOnce([
          { chunk_id: 'c2', source_id: 's2', content: 'ctx', metadata: {}, similarity: 0.85 },
        ]); // contextual_text

      const results = await service.searchRepresentations([0.1, 0.2], {}, 5, ['canonical', 'contextual_text']);
      const ctxHits = results.filter(r => r.representationType === 'contextual_text');
      expect(ctxHits).toHaveLength(1);
      expect(ctxHits[0]!.chunkId).toBe('c2');
    });

    it('returns empty array when document_chunk_representations table has no rows (fresh DB)', async () => {
      // All sub-queries return empty
      db.execute.mockResolvedValue([]);

      const results = await service.searchRepresentations([0.1, 0.2], {}, 5);
      expect(results).toEqual([]);
    });

    it('SQL for representation types includes representation_type filter', async () => {
      db.execute.mockResolvedValue([]);

      await service.searchRepresentations([1, 0], {}, 5, ['contextual_text']);

      const calls = db.execute.mock.calls;
      // At least one execute call should reference contextual_text in its SQL object
      const sqlStrings = calls.map((call: any[]) => JSON.stringify(call[0]));
      expect(sqlStrings.some((s: string) => s.includes('contextual_text'))).toBe(true);
    });

    it('continues returning canonical results even if a rep-type sub-query rejects', async () => {
      // canonical succeeds; contextual_text throws
      db.execute
        .mockResolvedValueOnce([
          { chunk_id: 'c1', source_id: 's1', content: 'x', metadata: {}, similarity: 0.9 },
        ])
        .mockRejectedValueOnce(new Error('pg error'));

      const results = await service.searchRepresentations([1, 0], {}, 5, ['canonical', 'contextual_text']);
      const canonical = results.filter(r => r.representationType === 'canonical');
      expect(canonical).toHaveLength(1);
    });
  });
});
