import { describe, it, expect } from 'vitest';
import { TableChunker } from '../../chunkers/table-chunker';
import type { StructuredDocument } from '../../structured-document';

describe('TableChunker', () => {
  it('keeps small table as a single chunk', () => {
    const chunker = new TableChunker({ chunkSize: 500 });
    const small = '| h1 | h2 |\n|----|----|\n| a | b |';
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: small, modality: 'table', title: 'Revenue',
        sectionPath: ['Financials'], parentId: null, pageStart: null, pageEnd: null,
      }],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('| h1 | h2 |');
  });

  it('splits a large table row-wise with header on every split', () => {
    const chunker = new TableChunker({ chunkSize: 120 });
    const rows = Array.from({ length: 20 }, (_, i) => `| r${i} | v${i} |`).join('\n');
    const big = `| h1 | h2 |\n|----|----|\n${rows}`;
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: big, modality: 'table', title: 'Big',
        sectionPath: ['Financials'], parentId: null, pageStart: null, pageEnd: null,
      }],
    };
    const out = chunker.chunk(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      // Every output chunk starts with the header row.
      expect(c.text.startsWith('| h1 | h2 |')).toBe(true);
      // Each split chunk also contains the separator row right after.
      expect(c.text.split('\n')[1]).toBe('|----|----|');
    }
  });

  it('passes text chunks through unchanged', () => {
    const chunker = new TableChunker({ chunkSize: 500 });
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: 'Some prose that is not a table.',
        modality: 'text',
        title: null,
        sectionPath: [],
        parentId: null,
        pageStart: null,
        pageEnd: null,
      }],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(1);
    expect(out[0]!.modality).toBe('text');
  });
});
