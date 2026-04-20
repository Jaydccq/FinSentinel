import { describe, it, expect } from 'vitest';
import { DefaultChunker } from '../../chunkers/default-chunker';
import type { StructuredDocument } from '../../structured-document';

describe('DefaultChunker', () => {
  // ── Non-text chunks: emit-as-is ──────────────────────────────────────────

  it('emits table chunk as-is when it does not exceed 4x chunkSize', () => {
    const chunker = new DefaultChunker({
      chunkSize: 100,
      chunkOverlap: 10,
      minChunkSizeChars: 10,
      maxNumChunks: 10000,
    });

    const tableText = '| col |\n|-----|\n' + '| val |\n'.repeat(20); // > 100 but < 400 (4 * 100)
    expect(tableText.length).toBeGreaterThan(100);
    expect(tableText.length).toBeLessThanOrEqual(400);

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

    const output = chunker.chunk(doc);

    expect(output).toHaveLength(1);
    expect(output[0]!.modality).toBe('table');
    expect(output[0]!.text).toBe(tableText);
  });

  it('truncates non-text chunk with [truncated] when it exceeds 4x chunkSize', () => {
    const chunker = new DefaultChunker({
      chunkSize: 50,
      chunkOverlap: 5,
      minChunkSizeChars: 5,
      maxNumChunks: 10000,
    });

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

    const output = chunker.chunk(doc);

    expect(output).toHaveLength(1);
    expect(output[0]!.text).toContain('[truncated]');
  });

  // ── Text chunks: splitting ────────────────────────────────────────────────

  it('splits a long text section into multiple chunks sharing parent sectionPath', () => {
    const chunker = new DefaultChunker({
      chunkSize: 300,
      chunkOverlap: 30,
      minChunkSizeChars: 50,
      maxNumChunks: 10000,
    });

    const longText = 'word '.repeat(200).trim(); // ~999 chars, well above 300
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

    const output = chunker.chunk(doc);

    expect(output.length).toBeGreaterThan(1);
    for (const c of output) {
      expect(c.sectionPath).toEqual(['Chapter 1', 'Risk Factors']);
      expect(c.title).toBe('Risk Factors');
      expect(c.modality).toBe('text');
    }
  });

  it('respects minChunkSizeChars for text blocks', () => {
    const chunker = new DefaultChunker({
      chunkSize: 500,
      chunkOverlap: 50,
      minChunkSizeChars: 200,
      maxNumChunks: 10000,
    });

    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        {
          text: 'Short.',
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

    const output = chunker.chunk(doc);

    expect(output).toHaveLength(1);
    expect(output[0]!.title).toBe('Section');
  });

  it('respects maxNumChunks cap', () => {
    const chunker = new DefaultChunker({
      chunkSize: 100,
      chunkOverlap: 10,
      minChunkSizeChars: 10,
      maxNumChunks: 3,
    });

    const chunks = Array.from({ length: 5 }, (_, i) => ({
      text: `Section ${i} content. `.repeat(3).trim(),
      title: `Section ${i}`,
      sectionPath: [] as string[],
      parentId: null as null,
      modality: 'text' as const,
      pageStart: null as null,
      pageEnd: null as null,
    }));

    const doc: StructuredDocument = { sourceFormat: 'markdown', chunks };
    const output = chunker.chunk(doc);

    expect(output.length).toBeLessThanOrEqual(3);
  });
});
