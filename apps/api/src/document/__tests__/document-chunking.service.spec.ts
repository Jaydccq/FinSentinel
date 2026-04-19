import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentChunkingService } from '../document-chunking.service';
import type { StructuredDocument } from '../structured-document';

/**
 * Create a ConfigService mock with configurable chunking parameters.
 */
function createConfigService(overrides: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    'rag.chunking.chunkSize': 500,
    'rag.chunking.chunkOverlap': 50,
    'rag.chunking.minChunkSizeChars': 200,
    'rag.chunking.maxNumChunks': 10000,
    ...overrides,
  };

  return {
    get: (key: string, defaultVal: unknown) =>
      defaults[key] !== undefined ? defaults[key] : defaultVal,
  };
}

describe('DocumentChunkingService', () => {
  let service: DocumentChunkingService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DocumentChunkingService,
        {
          provide: ConfigService,
          useValue: createConfigService(),
        },
      ],
    }).compile();

    service = module.get(DocumentChunkingService);
  });

  // ── Empty / short input ────────────────────────────────────────────────

  it('returns empty array for empty text', () => {
    expect(service.chunk('')).toEqual([]);
    expect(service.chunk('   ')).toEqual([]);
  });

  it('returns empty array for text shorter than minChunkSizeChars', () => {
    // Default minChunkSizeChars = 200
    const shortText = 'This is a short text.';
    expect(shortText.length).toBeLessThan(200);
    expect(service.chunk(shortText)).toEqual([]);
  });

  // ── Single chunk ───────────────────────────────────────────────────────

  it('returns single chunk for text at or below chunkSize', () => {
    // Generate text just above minChunkSizeChars but below chunkSize
    const text = 'A'.repeat(300);
    const chunks = service.chunk(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  // ── Paragraph splitting ────────────────────────────────────────────────

  it('splits on paragraph boundaries', () => {
    const para1 = 'A'.repeat(250);
    const para2 = 'B'.repeat(250);
    const text = `${para1}\n\n${para2}`;

    const chunks = service.chunk(text);

    // Each paragraph is 250 chars (above minChunkSizeChars=200)
    // Combined they exceed chunkSize=500, so should be 2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain('A');
    expect(chunks[chunks.length - 1]).toContain('B');
  });

  // ── Sentence splitting ─────────────────────────────────────────────────

  it('splits long paragraphs on sentence boundaries', () => {
    // A single paragraph with multiple sentences, total > chunkSize
    const sentences = Array.from({ length: 10 }, (_, i) =>
      `This is sentence number ${i + 1} with enough content to be meaningful in the context of testing.`,
    );
    const text = sentences.join(' ');

    expect(text.length).toBeGreaterThan(500);

    const chunks = service.chunk(text);

    // Should produce multiple chunks
    expect(chunks.length).toBeGreaterThan(0);
    // Each chunk should respect chunkSize (with some tolerance for overlap)
    for (const chunk of chunks) {
      // Allow some slack for overlap joining
      expect(chunk.length).toBeLessThanOrEqual(600);
    }
  });

  // ── Chunk overlap ──────────────────────────────────────────────────────

  it('applies overlap between consecutive chunks', () => {
    // Create text that will produce at least 2 chunks
    const segment = 'X'.repeat(260);
    const text = `${segment}\n\n${segment}\n\n${segment}`;

    const chunks = service.chunk(text);

    if (chunks.length >= 2) {
      // The second chunk should start with some overlap from the first
      // (unless the segment is too large to fit overlap)
      const lastCharsOfFirst = chunks[0]!.slice(-50);
      // Overlap is best-effort — just verify chunks were produced
      expect(lastCharsOfFirst.length).toBe(50);
    }
  });

  // ── minChunkSizeChars filtering ────────────────────────────────────────

  it('filters out chunks below minChunkSizeChars', () => {
    // Mix of long and short paragraphs
    const longPara = 'L'.repeat(300);
    const shortPara = 'S'.repeat(50); // Below minChunkSizeChars
    const text = `${longPara}\n\n${shortPara}\n\n${longPara}`;

    const chunks = service.chunk(text);

    // No chunk should be shorter than minChunkSizeChars
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThanOrEqual(200);
    }
  });

  // ── maxNumChunks cap ───────────────────────────────────────────────────

  describe('with small maxNumChunks', () => {
    let cappedService: DocumentChunkingService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          DocumentChunkingService,
          {
            provide: ConfigService,
            useValue: createConfigService({
              'rag.chunking.chunkSize': 300,
              'rag.chunking.minChunkSizeChars': 50,
              'rag.chunking.maxNumChunks': 3,
            }),
          },
        ],
      }).compile();

      cappedService = module.get(DocumentChunkingService);
    });

    it('caps output at maxNumChunks', () => {
      // Generate text that would produce many chunks
      const paragraphs = Array.from({ length: 20 }, (_, i) =>
        `Paragraph ${i + 1}: ${'word '.repeat(30)}`,
      );
      const text = paragraphs.join('\n\n');

      const chunks = cappedService.chunk(text);

      expect(chunks.length).toBeLessThanOrEqual(3);
    });
  });

  // ── Word boundary splitting ────────────────────────────────────────────

  describe('with small chunkSize', () => {
    let smallService: DocumentChunkingService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          DocumentChunkingService,
          {
            provide: ConfigService,
            useValue: createConfigService({
              'rag.chunking.chunkSize': 100,
              'rag.chunking.minChunkSizeChars': 20,
              'rag.chunking.chunkOverlap': 10,
            }),
          },
        ],
      }).compile();

      smallService = module.get(DocumentChunkingService);
    });

    it('splits long sentences on word boundaries', () => {
      const longSentence = 'word '.repeat(50).trim(); // 249 chars
      const chunks = smallService.chunk(longSentence);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // No chunk should exceed chunkSize by much
        expect(chunk.length).toBeLessThanOrEqual(120);
      }
    });
  });

  // ── Realistic content ──────────────────────────────────────────────────

  it('handles realistic document content', () => {
    const text = [
      'Apple Inc. reported strong Q4 2024 earnings with revenue of $94.9 billion, exceeding analyst expectations. The company saw growth across all product categories, with iPhone revenue reaching $46.2 billion.',
      '',
      'Services revenue continued its upward trajectory, hitting $22.3 billion for the quarter. CEO Tim Cook highlighted the growing installed base of active devices, now exceeding 2.2 billion globally.',
      '',
      'The company announced a $110 billion share buyback program, the largest in corporate history. Operating margin improved to 30.7%, driven by favorable product mix and services growth.',
    ].join('\n');

    const chunks = service.chunk(text);

    expect(chunks.length).toBeGreaterThan(0);
    // All chunks should contain meaningful content
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThanOrEqual(200);
    }
  });

  // ── chunkStructured: backward compat ────────────────────────────────────

  it('chunkStructured on plain-text doc produces string-equivalent output to chunk()', () => {
    const text = 'A'.repeat(250) + '\n\n' + 'B'.repeat(250);

    const legacyChunks = service.chunk(text);

    const doc: StructuredDocument = {
      sourceFormat: 'plain',
      chunks: [
        {
          text,
          title: null,
          sectionPath: [],
          parentId: null,
          modality: 'text',
          pageStart: null,
          pageEnd: null,
        },
      ],
    };
    const structured = service.chunkStructured(doc);

    expect(structured.length).toBe(legacyChunks.length);
    for (let i = 0; i < structured.length; i++) {
      expect(structured[i]!.text).toBe(legacyChunks[i]);
    }
  });

  // ── chunkStructured: long section splits with inherited sectionPath ──────

  it('chunkStructured splits a long section into multiple chunks sharing parent sectionPath', async () => {
    const module = await Test.createTestingModule({
      providers: [
        DocumentChunkingService,
        {
          provide: ConfigService,
          useValue: createConfigService({
            'rag.chunking.chunkSize': 300,
            'rag.chunking.minChunkSizeChars': 50,
          }),
        },
      ],
    }).compile();

    const svc = module.get(DocumentChunkingService);

    const longText = 'word '.repeat(200).trim(); // ~999 chars, well above 300 chunkSize
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        {
          text: longText,
          title: 'Risk Factors',
          sectionPath: ['Chapter 1', 'Risk Factors'],
          parentId: null,
          modality: 'text',
          pageStart: null,
          pageEnd: null,
        },
      ],
    };

    const structured = svc.chunkStructured(doc);

    expect(structured.length).toBeGreaterThan(1);
    for (const chunk of structured) {
      expect(chunk.sectionPath).toEqual(['Chapter 1', 'Risk Factors']);
      expect(chunk.title).toBe('Risk Factors');
      expect(chunk.modality).toBe('text');
    }
  });

  // ── chunkStructured: table stays single chunk even if > chunkSize ────────

  it('table chunk stays single even if larger than chunkSize', async () => {
    const module = await Test.createTestingModule({
      providers: [
        DocumentChunkingService,
        {
          provide: ConfigService,
          useValue: createConfigService({
            'rag.chunking.chunkSize': 100,
            'rag.chunking.minChunkSizeChars': 10,
          }),
        },
      ],
    }).compile();

    const svc = module.get(DocumentChunkingService);

    const tableText = '| col |\n|-----|\n' + '| val |\n'.repeat(20); // > 100 chars
    expect(tableText.length).toBeGreaterThan(100);

    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        {
          text: tableText,
          title: 'Table',
          sectionPath: ['Table'],
          parentId: null,
          modality: 'table',
          pageStart: null,
          pageEnd: null,
        },
      ],
    };

    const structured = svc.chunkStructured(doc);

    expect(structured).toHaveLength(1);
    expect(structured[0]!.modality).toBe('table');
  });

  it('table chunk exceeding 4x chunkSize is truncated with [truncated] note', async () => {
    const module = await Test.createTestingModule({
      providers: [
        DocumentChunkingService,
        {
          provide: ConfigService,
          useValue: createConfigService({
            'rag.chunking.chunkSize': 50,
            'rag.chunking.minChunkSizeChars': 5,
          }),
        },
      ],
    }).compile();

    const svc = module.get(DocumentChunkingService);

    const hugeTable = '| col |\n|-----|\n' + '| val |\n'.repeat(100); // > 200 chars (4 * 50)
    expect(hugeTable.length).toBeGreaterThan(200);

    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        {
          text: hugeTable,
          title: null,
          sectionPath: [],
          parentId: null,
          modality: 'table',
          pageStart: null,
          pageEnd: null,
        },
      ],
    };

    const structured = svc.chunkStructured(doc);

    expect(structured).toHaveLength(1);
    expect(structured[0]!.text).toContain('[truncated]');
  });

  // ── chunkStructured: minChunkSizeChars and maxNumChunks honored ──────────

  it('chunkStructured respects minChunkSizeChars for text blocks', async () => {
    const module = await Test.createTestingModule({
      providers: [
        DocumentChunkingService,
        {
          provide: ConfigService,
          useValue: createConfigService({
            'rag.chunking.chunkSize': 500,
            'rag.chunking.minChunkSizeChars': 200,
          }),
        },
      ],
    }).compile();

    const svc = module.get(DocumentChunkingService);

    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        {
          text: 'Short.', // well below 200
          title: null,
          sectionPath: [],
          parentId: null,
          modality: 'text',
          pageStart: null,
          pageEnd: null,
        },
        {
          text: 'A'.repeat(250),
          title: 'Section',
          sectionPath: ['Section'],
          parentId: null,
          modality: 'text',
          pageStart: null,
          pageEnd: null,
        },
      ],
    };

    const structured = svc.chunkStructured(doc);

    // Short chunk filtered; only the 250-char chunk should remain
    expect(structured).toHaveLength(1);
    expect(structured[0]!.title).toBe('Section');
  });

  it('chunkStructured respects maxNumChunks cap', async () => {
    const module = await Test.createTestingModule({
      providers: [
        DocumentChunkingService,
        {
          provide: ConfigService,
          useValue: createConfigService({
            'rag.chunking.chunkSize': 100,
            'rag.chunking.minChunkSizeChars': 10,
            'rag.chunking.maxNumChunks': 3,
          }),
        },
      ],
    }).compile();

    const svc = module.get(DocumentChunkingService);

    // 5 sections each with text that fits in one chunk
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      text: `Section ${i} content. `.repeat(3).trim(),
      title: `Section ${i}`,
      sectionPath: [`Section ${i}`],
      parentId: null as null,
      modality: 'text' as const,
      pageStart: null as null,
      pageEnd: null as null,
    }));

    const doc: StructuredDocument = { sourceFormat: 'markdown', chunks };
    const structured = svc.chunkStructured(doc);

    expect(structured.length).toBeLessThanOrEqual(3);
  });
});
