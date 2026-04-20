import { describe, it, expect } from 'vitest';
import { QaChunker } from '../../chunkers/qa-chunker';
import type { StructuredDocument } from '../../structured-document';

describe('QaChunker', () => {
  const chunker = new QaChunker({ chunkSize: 800 });

  it('pairs Q: / A: prefixes into single chunks', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: 'Q: What is the dividend policy?\nA: The board reviews dividends quarterly and pays out as warranted.\n\nQ: When is the next review?\nA: Next review is in Q2 2026.',
        modality: 'text',
        title: 'FAQ',
        sectionPath: ['FAQ'],
        parentId: null,
        pageStart: null,
        pageEnd: null,
      }],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toContain('dividend policy');
    expect(out[0]!.text).toContain('reviews dividends quarterly');
    expect(out[1]!.text).toContain('next review');
  });

  it('pairs Question: / Answer: prefixes', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: 'Question: Who owns the firm?\nAnswer: Public shareholders own the outstanding common stock.',
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
    expect(out[0]!.text).toContain('Public shareholders');
  });

  it('preserves non-text modalities (table) as-is', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: '| h1 | h2 |',
        modality: 'table',
        title: null,
        sectionPath: ['Data'],
        parentId: null,
        pageStart: null,
        pageEnd: null,
      }],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(1);
    expect(out[0]!.modality).toBe('table');
  });
});
