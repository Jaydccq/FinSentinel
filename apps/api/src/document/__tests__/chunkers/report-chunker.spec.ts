import { describe, it, expect } from 'vitest';
import { ReportChunker } from '../../chunkers/report-chunker';
import type { StructuredDocument } from '../../structured-document';

describe('ReportChunker', () => {
  const chunker = new ReportChunker({
    chunkSize: 500, chunkOverlap: 50, minChunkSizeChars: 100, maxNumChunks: 10000,
  });

  it('emits one chunk per heading section when sections are small', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        {
          text: 'Overview of operations and the broader business context. This description contains enough content to meet the minChunkSizeChars floor of 100 characters.',
          modality: 'text',
          title: 'Item 1. Business',
          sectionPath: ['Item 1. Business'],
          parentId: null,
          pageStart: null,
          pageEnd: null,
        },
        {
          text: 'Risk factors include regulation, litigation, macroeconomics, and several other systemic risks the company faces. Expanded content.',
          modality: 'text',
          title: 'Item 1A. Risk Factors',
          sectionPath: ['Item 1A. Risk Factors'],
          parentId: null,
          pageStart: null,
          pageEnd: null,
        },
      ],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(2);
    expect(out[0]!.title).toBe('Item 1. Business');
    expect(out[1]!.title).toBe('Item 1A. Risk Factors');
  });

  it('splits a long section on sentence boundaries and preserves sectionPath on splits', () => {
    const longText =
      Array.from({ length: 15 }, (_, i) => `Sentence ${i + 1} about Apple Inc and its revenue trajectory this year. `).join('') +
      Array.from({ length: 15 }, (_, i) => `More detail ${i + 1} on market positioning and competitive pressure faced. `).join('');
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: longText,
        modality: 'text',
        title: 'Long section',
        sectionPath: ['Long section'],
        parentId: null,
        pageStart: null,
        pageEnd: null,
      }],
    };
    const out = chunker.chunk(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.sectionPath).toEqual(['Long section']);
  });

  it('preserves table chunks as-is (delegates to downstream table handling)', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [{
        text: '| h1 | h2 |\n|----|----|\n| a | b |',
        modality: 'table',
        title: null,
        sectionPath: ['Financials'],
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
