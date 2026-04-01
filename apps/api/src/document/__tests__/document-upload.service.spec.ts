import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DocumentUploadService } from '../document-upload.service';
import { DocumentParseService } from '../document-parse.service';
import { DocumentVectorService } from '../document-vector.service';
import { HybridStorageService } from '../../storage/hybrid.storage';

// ── Mock factories ────────────────────────────────────────────────────────

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([{ id: 'doc-uuid-123' }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    insert: insertFn,
    update: updateFn,
    _mocks: { insertFn, insertValues, insertReturning, updateFn, updateSet, updateWhere },
  };
}

function createMockStorage() {
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from('content')),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockParseService() {
  return {
    parseToCleanText: vi.fn().mockReturnValue('Parsed text content that is sufficiently long for testing purposes.'),
  };
}

function createMockVectorService() {
  return {
    vectorize: vi.fn().mockResolvedValue(5),
  };
}

describe('DocumentUploadService', () => {
  let service: DocumentUploadService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockStorage: ReturnType<typeof createMockStorage>;
  let mockParseService: ReturnType<typeof createMockParseService>;
  let mockVectorService: ReturnType<typeof createMockVectorService>;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockStorage = createMockStorage();
    mockParseService = createMockParseService();
    mockVectorService = createMockVectorService();

    const module = await Test.createTestingModule({
      providers: [
        DocumentUploadService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: HybridStorageService, useValue: mockStorage },
        { provide: DocumentParseService, useValue: mockParseService },
        { provide: DocumentVectorService, useValue: mockVectorService },
      ],
    }).compile();

    service = module.get(DocumentUploadService);
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it('rejects empty files', async () => {
    const file = {
      buffer: Buffer.alloc(0),
      mimetype: 'text/plain',
      originalname: 'empty.txt',
    };

    await expect(service.upload(file, 'user-1', 'RESEARCH')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects files exceeding max size', async () => {
    const file = {
      buffer: Buffer.alloc(51 * 1024 * 1024), // 51 MB
      mimetype: 'text/plain',
      originalname: 'huge.txt',
    };

    await expect(service.upload(file, 'user-1', 'RESEARCH')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects unsupported MIME types', async () => {
    const file = {
      buffer: Buffer.from('binary data'),
      mimetype: 'application/octet-stream',
      originalname: 'data.bin',
    };

    await expect(service.upload(file, 'user-1', 'RESEARCH')).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── Successful upload ───────────────────────────────────────────────────

  it('uploads file to storage and creates DB record', async () => {
    const file = {
      buffer: Buffer.from('Test document content'),
      mimetype: 'text/plain',
      originalname: 'report.txt',
    };

    const result = await service.upload(file, 'user-1', 'SEC_FILING', 'Technology');

    // Verify result
    expect(result.id).toBe('doc-uuid-123');
    expect(result.status).toBe('VECTORIZED');

    // Verify storage was called
    expect(mockStorage.upload).toHaveBeenCalledTimes(1);
    const [storageKey, content, contentType] = mockStorage.upload.mock.calls[0];
    expect(storageKey).toContain('documents/user-1/');
    expect(storageKey).toContain('report.txt');
    expect(content).toEqual(file.buffer);
    expect(contentType).toBe('text/plain');

    // Verify DB insert was called
    expect(mockDb.insert).toHaveBeenCalled();

    // Verify parse + vectorize were called
    expect(mockParseService.parseToCleanText).toHaveBeenCalledWith(
      file.buffer,
      'text/plain',
    );
    expect(mockVectorService.vectorize).toHaveBeenCalledWith(
      'doc-uuid-123',
      expect.any(String),
      expect.objectContaining({
        doc_type: 'SEC_FILING',
        sector: 'Technology',
        region_id: 'US',
        source: 'report.txt',
      }),
    );
  });

  // ── Empty parse result ──────────────────────────────────────────────────

  it('sets status to EMPTY when parse returns empty text', async () => {
    mockParseService.parseToCleanText.mockReturnValue('');

    const file = {
      buffer: Buffer.from('%PDF-1.4 binary content'),
      mimetype: 'application/pdf',
      originalname: 'empty.pdf',
    };

    const result = await service.upload(file, 'user-1', 'RESEARCH');

    expect(result.id).toBe('doc-uuid-123');
    expect(result.status).toBe('EMPTY');
    expect(mockVectorService.vectorize).not.toHaveBeenCalled();
  });

  // ── Vectorization failure ───────────────────────────────────────────────

  it('sets status to FAILED when vectorization throws', async () => {
    mockVectorService.vectorize.mockRejectedValue(new Error('Embedding service unavailable'));

    const file = {
      buffer: Buffer.from('Test content'),
      mimetype: 'text/plain',
      originalname: 'test.txt',
    };

    const result = await service.upload(file, 'user-1', 'RESEARCH');

    expect(result.id).toBe('doc-uuid-123');
    expect(result.status).toBe('FAILED');
  });

  // ── File name sanitization ──────────────────────────────────────────────

  it('sanitizes file names with special characters', async () => {
    const file = {
      buffer: Buffer.from('content'),
      mimetype: 'text/plain',
      originalname: 'report (2024) [final].txt',
    };

    await service.upload(file, 'user-1', 'RESEARCH');

    const storageKey = mockStorage.upload.mock.calls[0][0] as string;
    // Special characters should be replaced with underscores
    expect(storageKey).not.toContain('(');
    expect(storageKey).not.toContain(')');
    expect(storageKey).not.toContain('[');
    expect(storageKey).not.toContain(']');
    expect(storageKey).toContain('report');
  });

  // ── Allowed MIME types ──────────────────────────────────────────────────

  it.each([
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'text/xml',
    'application/json',
    'application/xml',
    'application/pdf',
  ])('accepts MIME type: %s', async (mimetype) => {
    const file = {
      buffer: Buffer.from('content'),
      mimetype,
      originalname: 'test.file',
    };

    const result = await service.upload(file, 'user-1', 'RESEARCH');
    expect(result.id).toBe('doc-uuid-123');
  });
});
