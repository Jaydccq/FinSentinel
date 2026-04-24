import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    parseToMarkdown: vi.fn().mockResolvedValue('# Parsed markdown content that is sufficiently long for testing purposes.'),
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

    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'rag.parser.uploadMaxBytes') return 100 * 1024 * 1024;
        return defaultValue;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        DocumentUploadService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: HybridStorageService, useValue: mockStorage },
        { provide: DocumentParseService, useValue: mockParseService },
        { provide: DocumentVectorService, useValue: mockVectorService },
        { provide: ConfigService, useValue: mockConfigService },
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
      buffer: Buffer.alloc(101 * 1024 * 1024), // 101 MB > 100 MB cap
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
    const [storageKey, content, contentType] = mockStorage.upload.mock.calls[0] ?? [];
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

    const storageKey = mockStorage.upload.mock.calls[0]?.[0] as string;
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
  ])('accepts MIME type: %s', async (mimetype) => {
    const file = {
      buffer: Buffer.from('content'),
      mimetype,
      originalname: 'test.file',
    };

    const result = await service.upload(file, 'user-1', 'RESEARCH');
    expect(result.id).toBe('doc-uuid-123');
  });

  // ── R5.3: PDF / DOC / DOCX MIME whitelist ──────────────────────────────

  it('accepts application/pdf MIME — sync path calls parseToMarkdown', async () => {
    const file = { buffer: Buffer.alloc(1000), mimetype: 'application/pdf', originalname: 'sample.pdf' };
    const result = await service.upload(file as any, 'user-1', 'SEC_FILING');
    expect(result).toHaveProperty('id');
    expect(mockParseService.parseToMarkdown).toHaveBeenCalledWith(
      file.buffer,
      'application/pdf',
      'sample.pdf',
    );
    expect(mockParseService.parseToCleanText).not.toHaveBeenCalledWith(
      file.buffer,
      'application/pdf',
    );
  });

  it('accepts DOCX MIME — sync path calls parseToMarkdown', async () => {
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const file = {
      buffer: Buffer.alloc(1000),
      mimetype: docxMime,
      originalname: 'sample.docx',
    };
    const result = await service.upload(file as any, 'user-1', 'SEC_FILING');
    expect(result).toHaveProperty('id');
    expect(mockParseService.parseToMarkdown).toHaveBeenCalledWith(
      file.buffer,
      docxMime,
      'sample.docx',
    );
  });

  it('PDF upload lands as FAILED when parseToMarkdown throws (sidecar unavailable)', async () => {
    mockParseService.parseToMarkdown.mockRejectedValueOnce(new Error('PARSER_SIDECAR_UNAVAILABLE'));
    const file = { buffer: Buffer.alloc(1000), mimetype: 'application/pdf', originalname: 'sample.pdf' };
    const result = await service.upload(file as any, 'user-1', 'SEC_FILING');
    expect(result.status).toBe('FAILED');
  });

  it('rejects oversized PDF before reaching storage', async () => {
    // 101 MiB > default 100 MiB cap
    const file = { buffer: Buffer.alloc(101 * 1024 * 1024), mimetype: 'application/pdf', originalname: 'big.pdf' };
    await expect(service.upload(file as any, 'user-1', 'SEC_FILING')).rejects.toThrow(/exceeds maximum size/);
  });

  // ── P1-1: compensation delete + regionId + async-vectorize gate ────────

  describe('P1-1 hardening', () => {
    it('deletes the storage object when DB insert fails (no orphans)', async () => {
      mockDb._mocks.insertReturning.mockRejectedValueOnce(new Error('db down'));
      const file = {
        buffer: Buffer.from('Test content'),
        mimetype: 'text/plain',
        originalname: 'test.txt',
      };
      await expect(
        service.upload(file, 'user-1', 'RESEARCH'),
      ).rejects.toThrow('db down');
      expect(mockStorage.upload).toHaveBeenCalledTimes(1);
      expect(mockStorage.delete).toHaveBeenCalledTimes(1);
      const deletedKey = mockStorage.delete.mock.calls[0]?.[0] as string;
      expect(deletedKey).toMatch(/^documents\//);
    });

    it('does not call storage.delete when DB insert succeeds', async () => {
      const file = {
        buffer: Buffer.from('Test content'),
        mimetype: 'text/plain',
        originalname: 'test.txt',
      };
      await service.upload(file, 'user-1', 'RESEARCH');
      expect(mockStorage.delete).not.toHaveBeenCalled();
    });

    it('threads regionId through to DB insert and vectorization metadata', async () => {
      const file = {
        buffer: Buffer.from('Test content'),
        mimetype: 'text/plain',
        originalname: 'eu.txt',
      };
      await service.upload(file, 'user-1', 'RESEARCH', undefined, 'EU');

      const valuesArg = mockDb._mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(valuesArg.regionId).toBe('EU');

      const vectorMeta = mockVectorService.vectorize.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(vectorMeta.region_id).toBe('EU');
    });

    it("falls back to 'US' when regionId is not provided (preserves prior behavior)", async () => {
      const file = {
        buffer: Buffer.from('Test content'),
        mimetype: 'text/plain',
        originalname: 'us.txt',
      };
      await service.upload(file, 'user-1', 'RESEARCH');
      const valuesArg = mockDb._mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(valuesArg.regionId).toBe('US');
    });

    it('refuses sync fallback when requireAsyncVectorize=true and no producer is bound', async () => {
      // Re-create the service with the new config flag set to true.
      const cfg = {
        get: vi.fn().mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'rag.parser.uploadMaxBytes') return 100 * 1024 * 1024;
          if (key === 'rag.documents.requireAsyncVectorize') return true;
          return defaultValue;
        }),
      };
      const strictModule = await Test.createTestingModule({
        providers: [
          DocumentUploadService,
          { provide: 'DRIZZLE_DB', useValue: mockDb },
          { provide: HybridStorageService, useValue: mockStorage },
          { provide: DocumentParseService, useValue: mockParseService },
          { provide: DocumentVectorService, useValue: mockVectorService },
          { provide: ConfigService, useValue: cfg },
        ],
      }).compile();
      const strictSvc = strictModule.get(DocumentUploadService);

      const file = {
        buffer: Buffer.from('Test content'),
        mimetype: 'text/plain',
        originalname: 'test.txt',
      };
      await expect(strictSvc.upload(file, 'user-1', 'RESEARCH')).rejects.toThrow(
        /async vectorization required/i,
      );
    });
  });
});
