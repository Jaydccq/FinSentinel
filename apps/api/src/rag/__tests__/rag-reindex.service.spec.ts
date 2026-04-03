import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { RagReindexService } from '../rag-reindex.service';
import { VectorizeProducer } from '../../queue/vectorize.producer';
import { NewsEnrichProducer } from '../../queue/news-enrich.producer';

function withLimit(result: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
      }),
    }),
  };
}

function withWhere(result: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(result),
    }),
  };
}

describe('RagReindexService', () => {
  let service: RagReindexService;
  let mockDb: { select: Mock };
  let mockVectorizeProducer: { send: Mock };
  let mockNewsEnrichProducer: { send: Mock };

  beforeEach(async () => {
    mockDb = { select: vi.fn() };
    mockVectorizeProducer = { send: vi.fn().mockResolvedValue(undefined) };
    mockNewsEnrichProducer = { send: vi.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        RagReindexService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: VectorizeProducer, useValue: mockVectorizeProducer },
        { provide: NewsEnrichProducer, useValue: mockNewsEnrichProducer },
      ],
    }).compile();

    service = module.get(RagReindexService);
  });

  it('queues only documents that are missing chunks', async () => {
    mockDb.select
      .mockReturnValueOnce(withLimit([
        { id: 'doc-1', status: 'VECTORIZED', storageKey: 'documents/u/doc-1.txt' },
        { id: 'doc-2', status: 'VECTORIZED', storageKey: 'documents/u/doc-2.txt' },
        { id: 'doc-3', status: 'EMPTY', storageKey: 'documents/u/doc-3.txt' },
      ]))
      .mockReturnValueOnce(withWhere([{ sourceId: 'doc-2' }]));

    const result = await service.reindexMissingDocumentsForUser('user-1', 100, false);

    expect(result).toEqual({ queued: 1, ids: ['doc-1'] });
    expect(mockVectorizeProducer.send).toHaveBeenCalledTimes(1);
    expect(mockVectorizeProducer.send).toHaveBeenCalledWith('doc-1');
  });

  it('queues globally missing documents across all users', async () => {
    mockDb.select
      .mockReturnValueOnce(withLimit([
        { id: 'doc-1', status: 'VECTORIZED', storageKey: 'documents/a/doc-1.txt' },
        { id: 'doc-2', status: 'FAILED', storageKey: 'documents/b/doc-2.txt' },
      ]))
      .mockReturnValueOnce(withWhere([{ sourceId: 'doc-2' }]));

    const result = await service.reindexMissingDocuments(100, false);

    expect(result).toEqual({ queued: 1, ids: ['doc-1'] });
    expect(mockVectorizeProducer.send).toHaveBeenCalledWith('doc-1');
  });

  it('queues all eligible documents when force=true', async () => {
    mockDb.select.mockReturnValueOnce(withLimit([
      { id: 'doc-1', status: 'VECTORIZED', storageKey: 'documents/u/doc-1.txt' },
      { id: 'doc-2', status: 'FAILED', storageKey: 'documents/u/doc-2.txt' },
      { id: 'doc-3', status: 'EMPTY', storageKey: 'documents/u/doc-3.txt' },
    ]));

    const result = await service.reindexMissingDocumentsForUser('user-1', 100, true);

    expect(result).toEqual({ queued: 2, ids: ['doc-1', 'doc-2'] });
    expect(mockVectorizeProducer.send).toHaveBeenCalledWith('doc-1');
    expect(mockVectorizeProducer.send).toHaveBeenCalledWith('doc-2');
  });

  it('queues only news items missing chunks', async () => {
    mockDb.select
      .mockReturnValueOnce(withLimit([
        { id: 'news-1', articleUrl: 'https://example.com/1', enriched: true },
        { id: 'news-2', articleUrl: 'https://example.com/2', enriched: false },
      ]))
      .mockReturnValueOnce(withWhere([{ sourceId: 'news-2' }]));

    const result = await service.reindexMissingNews(100, false);

    expect(result).toEqual({ queued: 1, ids: ['news-1'] });
    expect(mockNewsEnrichProducer.send).toHaveBeenCalledWith('news-1');
  });

  it('reindexes a single owned document', async () => {
    mockDb.select.mockReturnValueOnce(withLimit([{ id: 'doc-1' }]));

    const result = await service.reindexDocumentById('user-1', 'doc-1');

    expect(result).toEqual({ queued: 1, ids: ['doc-1'] });
    expect(mockVectorizeProducer.send).toHaveBeenCalledWith('doc-1');
  });

  it('returns empty result when a single document is not owned by the user', async () => {
    mockDb.select.mockReturnValueOnce(withLimit([]));

    const result = await service.reindexDocumentById('user-1', 'missing');

    expect(result).toEqual({ queued: 0, ids: [] });
    expect(mockVectorizeProducer.send).not.toHaveBeenCalled();
  });
});
