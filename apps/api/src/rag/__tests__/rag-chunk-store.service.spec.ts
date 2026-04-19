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
});
