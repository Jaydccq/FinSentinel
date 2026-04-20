import { describe, it, expect } from 'vitest';
import { classifyDocType } from '../../chunkers/doc-type-classifier';
import type { StructuredChunk, StructuredDocument } from '../../structured-document';

const chunk = (overrides: Partial<StructuredChunk> = {}): StructuredChunk => ({
  text: '',
  modality: 'text',
  title: null,
  sectionPath: [],
  parentId: null,
  pageStart: null,
  pageEnd: null,
  ...overrides,
});

describe('classifyDocType', () => {
  it('flags table_heavy when tables make up >=40% of chunks', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        ...Array.from({ length: 6 }, () => chunk({ modality: 'table', text: '| a | b |' })),
        ...Array.from({ length: 4 }, () => chunk({ text: 'prose' })),
      ],
    };
    expect(classifyDocType(doc)).toBe('table_heavy');
  });

  it('flags qa when question lines make up >=20% of non-empty text lines', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [chunk({ text: 'Q: a?\nA: b.\nQ: c?\nA: d.\nOther.\nOther.' })],
    };
    expect(classifyDocType(doc)).toBe('qa');
  });

  it('flags report when >=3 distinct sectionPaths present', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        chunk({ title: 'Item 1', sectionPath: ['Item 1'], text: 'x' }),
        chunk({ title: 'Item 1A', sectionPath: ['Item 1A'], text: 'x' }),
        chunk({ title: 'Item 2', sectionPath: ['Item 2'], text: 'x' }),
        chunk({ title: 'Item 3', sectionPath: ['Item 3'], text: 'x' }),
      ],
    };
    expect(classifyDocType(doc)).toBe('report');
  });

  it('falls back to default for plain prose', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [chunk({ text: 'plain article text with no markers.' })],
    };
    expect(classifyDocType(doc)).toBe('default');
  });
});
