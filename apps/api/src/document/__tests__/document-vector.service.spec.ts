import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { DocumentVectorService } from '../document-vector.service';
import { DocumentChunkingService } from '../document-chunking.service';
import { MarkdownStructureService } from '../markdown-structure.service';
import { RagEmbeddingService } from '../../rag/rag-embedding.service';
import { RagChunkStoreService } from '../../rag/rag-chunk-store.service';
import { MetricsService } from '../../common/services/metrics.service';
import type { StructuredChunk, StructuredDocument } from '../structured-document';

// Minimal real implementations used in the structured-path tests
function makeRealMarkdownStructure() {
  return new MarkdownStructureService();
}

describe('DocumentVectorService', () => {
  let service: DocumentVectorService;
  let mockChunking: { chunk: Mock; chunkStructured: Mock };
  let mockMarkdownStructure: { parse: Mock };
  let mockEmbeddingService: { embedChunks: Mock };
  let mockChunkStore: { replaceChunks: Mock };

  const defaultStructuredChunks: StructuredChunk[] = [
    {
      text: 'chunk one',
      title: null,
      sectionPath: [],
      parentId: null,
      modality: 'text',
      pageStart: null,
      pageEnd: null,
    },
    {
      text: 'chunk two',
      title: null,
      sectionPath: [],
      parentId: null,
      modality: 'text',
      pageStart: null,
      pageEnd: null,
    },
  ];

  const defaultStructuredDoc: StructuredDocument = {
    sourceFormat: 'plain',
    chunks: defaultStructuredChunks,
  };

  beforeEach(async () => {
    mockChunking = {
      chunk: vi.fn().mockReturnValue(['chunk one', 'chunk two']),
      chunkStructured: vi.fn().mockReturnValue(defaultStructuredChunks),
    };

    mockMarkdownStructure = {
      parse: vi.fn().mockReturnValue(defaultStructuredDoc),
    };

    mockEmbeddingService = {
      embedChunks: vi.fn().mockResolvedValue([
        [1, 0, 0],
        [0, 1, 0],
      ]),
    };

    mockChunkStore = {
      replaceChunks: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        DocumentVectorService,
        { provide: DocumentChunkingService, useValue: mockChunking },
        { provide: MarkdownStructureService, useValue: mockMarkdownStructure },
        { provide: RagEmbeddingService, useValue: mockEmbeddingService },
        { provide: RagChunkStoreService, useValue: mockChunkStore },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            observeHistogram: vi.fn(),
            startHistogramTimer: vi.fn(() => vi.fn()),
          },
        },
      ],
    }).compile();

    service = module.get(DocumentVectorService);
  });

  // ── Core vectorization path ──────────────────────────────────────────────

  it('parses, chunks, embeds, and stores document chunks via structured path', async () => {
    const chunkCount = await service.vectorize('doc-1', 'Long document body', {
      doc_type: 'SEC_FILING',
      sector: 'Technology',
      region_id: 'US',
      source: 'report.txt',
      date: '2026-04-02',
    });

    expect(chunkCount).toBe(2);
    expect(mockMarkdownStructure.parse).toHaveBeenCalledWith('Long document body');
    expect(mockChunking.chunkStructured).toHaveBeenCalledWith(defaultStructuredDoc);
    expect(mockEmbeddingService.embedChunks).toHaveBeenCalledWith(['chunk one', 'chunk two']);
    expect(mockChunkStore.replaceChunks).toHaveBeenCalledWith(
      'document',
      'doc-1',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'chunk one',
          embedding: [1, 0, 0],
          metadata: expect.objectContaining({
            doc_type: 'SEC_FILING',
            source_type: 'document',
            source_id: 'doc-1',
            chunk_index: 0,
          }),
        }),
      ]),
    );
  });

  it('stores NEWS payloads under the news source type', async () => {
    await service.vectorize('news-1', 'Long news body', {
      doc_type: 'NEWS',
      sector: '',
      region_id: 'US',
      source: 'POLYGON',
      date: '2026-04-02',
    });

    expect(mockChunkStore.replaceChunks).toHaveBeenCalledWith(
      'news',
      'news-1',
      expect.any(Array),
    );
  });

  it('returns 0 and skips embedding for empty text', async () => {
    const chunkCount = await service.vectorize('doc-1', '', {
      doc_type: 'SEC_FILING',
      sector: 'Technology',
      region_id: 'US',
      source: 'report.txt',
      date: '2026-04-02',
    });

    expect(chunkCount).toBe(0);
    expect(mockEmbeddingService.embedChunks).not.toHaveBeenCalled();
    expect(mockChunkStore.replaceChunks).not.toHaveBeenCalled();
  });

  // ── Markdown input: sectionPath + title propagated ───────────────────────

  it('markdown input carries correct sectionPath and title through to replaceChunks', async () => {
    const markdownChunks: StructuredChunk[] = [
      {
        text: 'Risk body.',
        title: 'Risk Factors',
        sectionPath: ['Chapter 1', 'Risk Factors'],
        parentId: null,
        modality: 'text',
        pageStart: null,
        pageEnd: null,
      },
    ];
    mockMarkdownStructure.parse.mockReturnValue({
      sourceFormat: 'markdown',
      chunks: markdownChunks,
    });
    mockChunking.chunkStructured.mockReturnValue(markdownChunks);
    mockEmbeddingService.embedChunks.mockResolvedValue([[0.1, 0.2]]);

    await service.vectorize('doc-md', '# Chapter 1\n## Risk Factors\nRisk body.', {
      doc_type: 'REPORT',
      sector: 'Finance',
      region_id: 'US',
      source: 'report.md',
      date: '2026-04-19',
    });

    expect(mockChunkStore.replaceChunks).toHaveBeenCalledWith(
      'document',
      'doc-md',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Risk body.',
          sectionPath: 'Chapter 1 / Risk Factors',
          title: 'Risk Factors',
          metadata: expect.objectContaining({
            section_path: 'Chapter 1 / Risk Factors',
            title: 'Risk Factors',
          }),
        }),
      ]),
    );
  });

  // ── Plain-text input: null sectionPath + null title ──────────────────────

  it('plain-text input produces null title and null sectionPath in replaceChunks payload', async () => {
    const plainChunks: StructuredChunk[] = [
      {
        text: 'Some plain text content that is long enough.',
        title: null,
        sectionPath: [],
        parentId: null,
        modality: 'text',
        pageStart: null,
        pageEnd: null,
      },
    ];
    mockMarkdownStructure.parse.mockReturnValue({
      sourceFormat: 'plain',
      chunks: plainChunks,
    });
    mockChunking.chunkStructured.mockReturnValue(plainChunks);
    mockEmbeddingService.embedChunks.mockResolvedValue([[0.5, 0.5]]);

    await service.vectorize('doc-plain', 'Some plain text content that is long enough.', {
      doc_type: 'NOTE',
      sector: '',
      region_id: '',
      source: 'note.txt',
      date: '2026-04-19',
    });

    expect(mockChunkStore.replaceChunks).toHaveBeenCalledWith(
      'document',
      'doc-plain',
      expect.arrayContaining([
        expect.objectContaining({
          sectionPath: null,
          title: null,
        }),
      ]),
    );
  });

  // ── Issuer/ticker extraction wired into chunk metadata ───────────────────

  it('writes issuerName + tickers into chunk metadata when extractable', async () => {
    // Override the markdown-structure mock for THIS test so the extractor
    // sees recognisable issuer text in the sample.
    const recognisableChunks: StructuredChunk[] = [
      { text: 'Apple Inc. reported revenue of $383B. AAPL remains our top pick.',
        title: null, sectionPath: [], parentId: null, modality: 'text',
        pageStart: null, pageEnd: null },
    ];
    mockMarkdownStructure.parse.mockReturnValueOnce({
      sourceFormat: 'plain', chunks: recognisableChunks,
    });
    mockChunking.chunkStructured.mockReturnValueOnce(recognisableChunks);
    mockEmbeddingService.embedChunks.mockResolvedValueOnce([[1, 0, 0]]);

    await service.vectorize('doc-id-1', 'Apple Inc. reported revenue of $383B. AAPL remains our top pick.', {
      doc_type: 'RESEARCH',
      sector: 'Technology',
      region_id: 'US',
      source: 'AAPL_research.md',
      date: '2026-01-01',
    });

    const call = mockChunkStore.replaceChunks.mock.calls[0];
    const persistedChunks = call[2];
    expect(persistedChunks[0].metadata.tickers).toEqual(['AAPL']);
    expect(persistedChunks[0].metadata.issuerName).toBe('Apple Inc.');
  });

  it('always sets metadata.tickers (empty array when nothing extractable)', async () => {
    // Relies on the default markdown-structure mock which produces chunks with bland text.
    await service.vectorize('doc-id-2', 'some text', {
      doc_type: 'NEWS',
      sector: 'General',
      region_id: 'US',
      source: 'general-news.txt',
      date: '2026-01-01',
    });

    const call = mockChunkStore.replaceChunks.mock.calls[0];
    const firstChunk = call[2][0];
    expect(firstChunk.metadata.tickers).toEqual([]);
    expect(firstChunk.metadata.issuerName).toBeUndefined();
  });

  // ── End-to-end with real MarkdownStructureService ────────────────────────

  it('end-to-end: real MarkdownStructureService produces section_path metadata for markdown', async () => {
    const realMarkdownStructure = makeRealMarkdownStructure();

    // Use real chunking mock that delegates to real structure service
    const realChunkingMock = {
      chunk: vi.fn(),
      chunkStructured: vi.fn((doc: StructuredDocument) => doc.chunks),
    };

    const module = await Test.createTestingModule({
      providers: [
        DocumentVectorService,
        { provide: DocumentChunkingService, useValue: realChunkingMock },
        { provide: MarkdownStructureService, useValue: realMarkdownStructure },
        { provide: RagEmbeddingService, useValue: mockEmbeddingService },
        { provide: RagChunkStoreService, useValue: mockChunkStore },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            observeHistogram: vi.fn(),
            startHistogramTimer: vi.fn(() => vi.fn()),
          },
        },
      ],
    }).compile();

    const svc = module.get(DocumentVectorService);
    mockEmbeddingService.embedChunks.mockResolvedValue([[1, 0]]);

    await svc.vectorize('doc-e2e', '# Risk Section\n\nRisk body.', {
      doc_type: 'REPORT',
      sector: 'Finance',
      region_id: 'US',
      source: 'report.md',
      date: '2026-04-19',
    });

    const call = (mockChunkStore.replaceChunks as Mock).mock.calls.at(-1);
    const rows = call?.[2] as Array<{ metadata: Record<string, unknown>; sectionPath: unknown; title: unknown }>;
    expect(rows).toBeDefined();
    expect(rows[0]!.sectionPath).toBe('Risk Section');
    expect(rows[0]!.title).toBe('Risk Section');
    expect(rows[0]!.metadata['section_path']).toBe('Risk Section');
  });
});
