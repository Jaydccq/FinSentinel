import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { VectorizeConsumer } from '../vectorize.consumer';
import { DocumentParseService } from '../../document/document-parse.service';
import { DocumentVectorService } from '../../document/document-vector.service';
import { HybridStorageService } from '../../storage/hybrid.storage';
import type { Job } from 'bullmq';
import type { VectorizeJobData } from '../vectorize.consumer';

// ── Mock factories ─────────────────────────────────────────────────────────

function createMockDb() {
  const selectLimit = vi.fn().mockResolvedValue([
    {
      id: 'doc-uuid-1',
      storageKey: 'documents/user-1/report.txt',
      docType: 'RESEARCH',
      sector: 'Technology',
      originalFileName: 'report.txt',
    },
  ]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    select: selectFn,
    update: updateFn,
    _mocks: { selectFn, selectFrom, selectWhere, selectLimit, updateFn, updateSet, updateWhere },
  };
}

function createMockParseService() {
  return {
    parseToCleanText: vi
      .fn()
      .mockReturnValue(
        'This is parsed document content that is long enough for chunking and vectorization purposes.',
      ),
  };
}

function createMockVectorService() {
  return {
    vectorize: vi.fn().mockResolvedValue(5),
  };
}

function createMockStorage() {
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from('raw file content')),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockJob(data: VectorizeJobData): Job<VectorizeJobData> {
  return { data, id: 'job-1', attemptsMade: 0 } as unknown as Job<VectorizeJobData>;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VectorizeConsumer', () => {
  let consumer: VectorizeConsumer;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockParseService: ReturnType<typeof createMockParseService>;
  let mockVectorService: ReturnType<typeof createMockVectorService>;
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockParseService = createMockParseService();
    mockVectorService = createMockVectorService();
    mockStorage = createMockStorage();

    const module = await Test.createTestingModule({
      providers: [
        VectorizeConsumer,
        { provide: 'BULLMQ_CONNECTION', useValue: { host: 'localhost', port: 6379 } },
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: DocumentParseService, useValue: mockParseService },
        { provide: DocumentVectorService, useValue: mockVectorService },
        { provide: HybridStorageService, useValue: mockStorage },
      ],
    }).compile();

    consumer = module.get(VectorizeConsumer);
    // Do NOT call onModuleInit — it would try to connect to Redis.
    // We test the process() method directly.
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  it('loads document, downloads, parses, vectorizes, and updates status', async () => {
    const job = createMockJob({ docId: 'doc-uuid-1' });

    await consumer.process(job);

    // 1. Should download content from storage
    expect(mockStorage.download).toHaveBeenCalledWith('documents/user-1/report.txt');

    // 2. Should parse the downloaded content
    expect(mockParseService.parseToCleanText).toHaveBeenCalledWith(
      Buffer.from('raw file content'),
      'text/plain', // .txt extension
    );

    // 3. Should vectorize with correct metadata
    expect(mockVectorService.vectorize).toHaveBeenCalledWith(
      'doc-uuid-1',
      expect.any(String),
      expect.objectContaining({
        doc_type: 'RESEARCH',
        sector: 'Technology',
        region_id: 'US',
        source: 'report.txt',
      }),
    );

    // 4. Should update status to VECTORIZED with chunk count
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'VECTORIZED', chunkCount: 5 }),
    );
  });

  // ── Document not found ─────────────────────────────────────────────────

  it('throws when document is not found in DB', async () => {
    mockDb._mocks.selectLimit.mockResolvedValue([]);

    const job = createMockJob({ docId: 'missing-doc' });

    await expect(consumer.process(job)).rejects.toThrow('Document missing-doc not found');
  });

  // ── Empty parse result ─────────────────────────────────────────────────

  it('marks document as EMPTY when parse returns empty text', async () => {
    mockParseService.parseToCleanText.mockReturnValue('');

    const job = createMockJob({ docId: 'doc-uuid-1' });

    await consumer.process(job);

    // Should NOT call vectorize
    expect(mockVectorService.vectorize).not.toHaveBeenCalled();

    // Should update status to EMPTY
    expect(mockDb._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'EMPTY' }),
    );
  });

  // ── MIME type guessing ─────────────────────────────────────────────────

  it('guesses correct MIME type from file extension', async () => {
    // Change the mock to return a .pdf file
    mockDb._mocks.selectLimit.mockResolvedValue([
      {
        id: 'doc-uuid-2',
        storageKey: 'documents/user-1/report.pdf',
        docType: 'SEC_FILING',
        sector: null,
        originalFileName: 'report.pdf',
      },
    ]);

    const job = createMockJob({ docId: 'doc-uuid-2' });
    await consumer.process(job);

    expect(mockParseService.parseToCleanText).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/pdf',
    );
  });

  // ── Vectorization failure propagates ───────────────────────────────────

  it('propagates vectorization errors (BullMQ handles retries)', async () => {
    mockVectorService.vectorize.mockRejectedValue(new Error('Embedding API down'));

    const job = createMockJob({ docId: 'doc-uuid-1' });

    await expect(consumer.process(job)).rejects.toThrow('Embedding API down');
  });

  // ── Null sector ────────────────────────────────────────────────────────

  it('handles null sector by passing empty string in metadata', async () => {
    mockDb._mocks.selectLimit.mockResolvedValue([
      {
        id: 'doc-uuid-3',
        storageKey: 'documents/user-1/data.csv',
        docType: 'RESEARCH',
        sector: null,
        originalFileName: 'data.csv',
      },
    ]);

    const job = createMockJob({ docId: 'doc-uuid-3' });
    await consumer.process(job);

    expect(mockVectorService.vectorize).toHaveBeenCalledWith(
      'doc-uuid-3',
      expect.any(String),
      expect.objectContaining({ sector: '' }),
    );
  });
});
