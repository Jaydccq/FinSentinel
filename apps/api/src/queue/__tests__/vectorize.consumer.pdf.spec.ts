// apps/api/src/queue/__tests__/vectorize.consumer.pdf.spec.ts
//
// R5.4 — VectorizeConsumer PDF / DOC / DOCX sidecar routing.
// Mirror the Nest TestingModule harness from vectorize.consumer.spec.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { VectorizeConsumer } from '../vectorize.consumer';
import { DocumentParseService } from '../../document/document-parse.service';
import { DocumentVectorService } from '../../document/document-vector.service';
import { HybridStorageService } from '../../storage/hybrid.storage';
import { ParserSidecarClient } from '../../document/parser-sidecar.client';
import type { Job } from 'bullmq';
import type { VectorizeJobData } from '../vectorize.consumer';

// ── Mock factories ─────────────────────────────────────────────────────────

function makeDocRow(overrides: Partial<{
  id: string;
  storageKey: string;
  docType: string;
  sector: string | null;
  originalFileName: string;
}> = {}) {
  return {
    id: 'doc-uuid-pdf',
    storageKey: 'documents/user-1/report.pdf',
    docType: 'SEC_FILING',
    sector: null,
    originalFileName: 'report.pdf',
    ...overrides,
  };
}

function createMockDb(docRow: ReturnType<typeof makeDocRow>) {
  const selectLimit = vi.fn().mockResolvedValue([docRow]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    select: selectFn,
    update: updateFn,
    _mocks: { selectLimit, updateFn, updateSet, updateWhere },
  };
}

function createMockStorage() {
  return {
    download: vi.fn().mockResolvedValue(Buffer.from('%PDF-stub')),
  };
}

function createMockJob(data: VectorizeJobData): Job<VectorizeJobData> {
  return { data, id: 'job-pdf-1', attemptsMade: 0 } as unknown as Job<VectorizeJobData>;
}

/** A ParserSidecarResponse that satisfies the Zod schema and is long enough */
function sidecarSuccess() {
  return {
    markdown: '# Sample\n\nStub parser output with more than fifty characters for the threshold.',
    metadata: {
      pageCount: 1,
      headings: [],
      tableCount: 0,
      parserVersion: 'stub-0.1',
      sourceMimeType: 'application/pdf',
    },
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────

async function buildConsumer(
  docRow: ReturnType<typeof makeDocRow>,
  sidecar: Partial<{ parse: ReturnType<typeof vi.fn> }>,
  parseService: Partial<{ parseToCleanText: ReturnType<typeof vi.fn> }>,
  vectorService: Partial<{ vectorize: ReturnType<typeof vi.fn> }> = {},
) {
  const mockDb = createMockDb(docRow);
  const mockStorage = createMockStorage();

  const module = await Test.createTestingModule({
    providers: [
      VectorizeConsumer,
      { provide: 'BULLMQ_CONNECTION', useValue: { host: 'localhost', port: 6379 } },
      { provide: 'DRIZZLE_DB', useValue: mockDb },
      { provide: DocumentParseService, useValue: parseService },
      { provide: DocumentVectorService, useValue: { vectorize: vi.fn().mockResolvedValue(3), ...vectorService } },
      { provide: HybridStorageService, useValue: mockStorage },
      { provide: ParserSidecarClient, useValue: sidecar },
    ],
  }).compile();

  return { consumer: module.get(VectorizeConsumer), mockDb };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VectorizeConsumer PDF routing (R5.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── PDF → sidecar ─────────────────────────────────────────────────────

  it('routes application/pdf through ParserSidecarClient, not DocumentParseService', async () => {
    const sidecar = { parse: vi.fn().mockResolvedValue(sidecarSuccess()) };
    const parseService = { parseToCleanText: vi.fn() };

    const { consumer } = await buildConsumer(
      makeDocRow({ originalFileName: 'report.pdf' }),
      sidecar,
      parseService,
    );

    await consumer.process(createMockJob({ docId: 'doc-uuid-pdf' }));

    expect(sidecar.parse).toHaveBeenCalledTimes(1);
    expect(sidecar.parse).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/pdf',
      'report.pdf',
    );
    expect(parseService.parseToCleanText).not.toHaveBeenCalled();
  });

  // ── DOC → sidecar ─────────────────────────────────────────────────────

  it('routes application/msword (.doc) through ParserSidecarClient', async () => {
    const sidecar = { parse: vi.fn().mockResolvedValue(sidecarSuccess()) };
    const parseService = { parseToCleanText: vi.fn() };

    const { consumer } = await buildConsumer(
      makeDocRow({ originalFileName: 'memo.doc', storageKey: 'documents/user-1/memo.doc' }),
      sidecar,
      parseService,
    );

    await consumer.process(createMockJob({ docId: 'doc-uuid-pdf' }));

    expect(sidecar.parse).toHaveBeenCalledTimes(1);
    expect(sidecar.parse).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/msword',
      'memo.doc',
    );
    expect(parseService.parseToCleanText).not.toHaveBeenCalled();
  });

  // ── DOCX → sidecar ────────────────────────────────────────────────────

  it('routes application/vnd.openxmlformats (.docx) through ParserSidecarClient', async () => {
    const sidecar = { parse: vi.fn().mockResolvedValue(sidecarSuccess()) };
    const parseService = { parseToCleanText: vi.fn() };

    const { consumer } = await buildConsumer(
      makeDocRow({ originalFileName: 'contract.docx', storageKey: 'documents/user-1/contract.docx' }),
      sidecar,
      parseService,
    );

    await consumer.process(createMockJob({ docId: 'doc-uuid-pdf' }));

    expect(sidecar.parse).toHaveBeenCalledTimes(1);
    expect(sidecar.parse).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'contract.docx',
    );
    expect(parseService.parseToCleanText).not.toHaveBeenCalled();
  });

  // ── Sidecar failure → FAILED status ───────────────────────────────────

  it('marks document FAILED when sidecar throws, and re-throws for BullMQ retry', async () => {
    const sidecar = { parse: vi.fn().mockRejectedValue(new Error('PARSER_EMPTY_OUTPUT')) };
    const parseService = { parseToCleanText: vi.fn() };

    const { consumer, mockDb } = await buildConsumer(
      makeDocRow({ originalFileName: 'report.pdf' }),
      sidecar,
      parseService,
    );

    await expect(consumer.process(createMockJob({ docId: 'doc-uuid-pdf' }))).rejects.toThrow(
      'PARSER_EMPTY_OUTPUT',
    );

    expect(mockDb._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  // ── text/plain → parseService, not sidecar ────────────────────────────

  it('falls through to parseService for text/plain MIME, sidecar not called', async () => {
    const sidecar = { parse: vi.fn() };
    const parseService = {
      parseToCleanText: vi.fn().mockReturnValue(
        'hello world — more than 50 characters so vectorize is called without issue',
      ),
    };

    const { consumer } = await buildConsumer(
      makeDocRow({ originalFileName: 'readme.txt', storageKey: 'documents/user-1/readme.txt' }),
      sidecar,
      parseService,
    );

    await consumer.process(createMockJob({ docId: 'doc-uuid-pdf' }));

    expect(sidecar.parse).not.toHaveBeenCalled();
    expect(parseService.parseToCleanText).toHaveBeenCalledTimes(1);
    expect(parseService.parseToCleanText).toHaveBeenCalledWith(
      expect.any(Buffer),
      'text/plain',
    );
  });
});

// ── R5.6 — parser metadata threaded onto chunk metadata ──────────────────────

describe('VectorizeConsumer parser metadata (R5.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads parser metadata (pageCount, parserVersion, sourceMimeType) onto persisted chunk metadata', async () => {
    const sidecar = {
      parse: vi.fn().mockResolvedValue({
        markdown: '# Doc\n\nBody content above threshold so the parser_empty_output check does not fire.',
        metadata: {
          pageCount: 42,
          headings: [],
          tableCount: 0,
          parserVersion: 'stub-0.1',
          sourceMimeType: 'application/pdf',
        },
      }),
    };

    const vectorServiceCalls: Record<string, string>[] = [];
    const vectorService = {
      vectorize: vi.fn().mockImplementation((_id: string, _text: string, metadata: Record<string, string>) => {
        vectorServiceCalls.push(metadata);
        return Promise.resolve(1);
      }),
    };

    const { consumer } = await buildConsumer(
      makeDocRow({ originalFileName: 'report.pdf' }),
      sidecar,
      { parseToCleanText: vi.fn() },
      vectorService,
    );

    await consumer.process(createMockJob({ docId: 'doc-uuid-pdf' }));

    expect(vectorServiceCalls).toHaveLength(1);
    const persisted = vectorServiceCalls[0]!;
    expect(persisted.parser_page_count).toBe('42');
    expect(persisted.parser_version).toBe('stub-0.1');
    expect(persisted.parser_source_mime).toBe('application/pdf');
  });

  it('does NOT attach parser_* keys when the non-sidecar path is used', async () => {
    const sidecar = { parse: vi.fn() };
    const parseService = {
      parseToCleanText: vi.fn().mockReturnValue(
        'plain text content long enough to pass the empty-text guard without issue',
      ),
    };

    const vectorServiceCalls: Record<string, string>[] = [];
    const vectorService = {
      vectorize: vi.fn().mockImplementation((_id: string, _text: string, metadata: Record<string, string>) => {
        vectorServiceCalls.push(metadata);
        return Promise.resolve(1);
      }),
    };

    const { consumer } = await buildConsumer(
      makeDocRow({ originalFileName: 'readme.txt', storageKey: 'documents/user-1/readme.txt' }),
      sidecar,
      parseService,
      vectorService,
    );

    await consumer.process(createMockJob({ docId: 'doc-uuid-pdf' }));

    const persisted = vectorServiceCalls[0]!;
    expect(persisted.parser_page_count).toBeUndefined();
    expect(persisted.parser_version).toBeUndefined();
    expect(persisted.parser_source_mime).toBeUndefined();
  });
});
