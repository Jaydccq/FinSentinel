import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { MarkdownStructureService } from '../markdown-structure.service';

describe('MarkdownStructureService', () => {
  let service: MarkdownStructureService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [MarkdownStructureService],
    }).compile();

    service = module.get(MarkdownStructureService);
  });

  // ── Empty input ──────────────────────────────────────────────────────────

  it('returns empty chunks for empty string', () => {
    const result = service.parse('');
    expect(result.chunks).toHaveLength(0);
    expect(result.sourceFormat).toBe('plain');
  });

  it('returns empty chunks for whitespace-only string', () => {
    const result = service.parse('   \n\n  ');
    expect(result.chunks).toHaveLength(0);
  });

  // ── Plain text (no headings) ─────────────────────────────────────────────

  it('plain text produces one root chunk with empty sectionPath and null title', () => {
    const md = 'This is a paragraph without any headings.';
    const result = service.parse(md);

    expect(result.sourceFormat).toBe('plain');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      text: 'This is a paragraph without any headings.',
      title: null,
      sectionPath: [],
      parentId: null,
      modality: 'text',
      pageStart: null,
      pageEnd: null,
    });
  });

  // ── Single ATX H1 ────────────────────────────────────────────────────────

  it('single H1 produces one chunk with correct title and sectionPath', () => {
    const md = '# Introduction\n\nThis is the intro body.';
    const result = service.parse(md);

    expect(result.sourceFormat).toBe('markdown');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      text: 'This is the intro body.',
      title: 'Introduction',
      sectionPath: ['Introduction'],
      modality: 'text',
    });
  });

  it('heading with no following content produces no body chunks', () => {
    const md = '# Heading Only\n';
    const result = service.parse(md);
    expect(result.chunks).toHaveLength(0);
  });

  // ── Nested headings ──────────────────────────────────────────────────────

  it('nested H1/H2/H3 produces correct sectionPath stacks', () => {
    const md = [
      '# Chapter 1',
      '',
      'Chapter intro.',
      '',
      '## Section 1.1',
      '',
      'Section body.',
      '',
      '### Subsection 1.1.1',
      '',
      'Sub body.',
    ].join('\n');

    const result = service.parse(md);

    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[0]!.sectionPath).toEqual(['Chapter 1']);
    expect(result.chunks[0]!.title).toBe('Chapter 1');

    expect(result.chunks[1]!.sectionPath).toEqual(['Chapter 1', 'Section 1.1']);
    expect(result.chunks[1]!.title).toBe('Section 1.1');

    expect(result.chunks[2]!.sectionPath).toEqual(['Chapter 1', 'Section 1.1', 'Subsection 1.1.1']);
    expect(result.chunks[2]!.title).toBe('Subsection 1.1.1');
  });

  it('less-deep heading pops the stack correctly', () => {
    const md = [
      '# Chapter 1',
      '',
      '## Section 1.1',
      '',
      'Body A.',
      '',
      '# Chapter 2',
      '',
      'Body B.',
    ].join('\n');

    const result = service.parse(md);

    const sectionPaths = result.chunks.map((c) => c.sectionPath);
    expect(sectionPaths).toEqual([
      ['Chapter 1', 'Section 1.1'],
      ['Chapter 2'],
    ]);
  });

  // ── Table detection ──────────────────────────────────────────────────────

  it('table after H2 is emitted with modality="table" and the H2 sectionPath', () => {
    const md = [
      '## Financial Data',
      '',
      '| Quarter | Revenue |',
      '|---------|---------|',
      '| Q1      | $1B     |',
      '| Q2      | $2B     |',
    ].join('\n');

    const result = service.parse(md);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.modality).toBe('table');
    expect(result.chunks[0]!.sectionPath).toEqual(['Financial Data']);
    expect(result.chunks[0]!.title).toBe('Financial Data');
    expect(result.chunks[0]!.text).toContain('Quarter');
  });

  it('pipe-delimited lines without a separator row are treated as paragraph', () => {
    const md = '| col1 | col2 |\n| val1 | val2 |';
    const result = service.parse(md);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.modality).toBe('text');
  });

  // ── Fenced code blocks ───────────────────────────────────────────────────

  it('fenced code block under H1 is emitted with modality="text" and verbatim content', () => {
    const md = [
      '# Implementation',
      '',
      '```typescript',
      'const x = 1;',
      '# not a heading inside fence',
      '```',
    ].join('\n');

    const result = service.parse(md);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.modality).toBe('text');
    expect(result.chunks[0]!.sectionPath).toEqual(['Implementation']);
    // The inner "# not a heading" must appear verbatim, not parsed as a heading
    expect(result.chunks[0]!.text).toContain('# not a heading inside fence');
  });

  it('tilde fenced block is also captured verbatim', () => {
    const md = '~~~\nsome code\n~~~\n';
    const result = service.parse(md);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.modality).toBe('text');
    expect(result.chunks[0]!.text).toContain('some code');
  });

  // ── Heading with trailing whitespace ────────────────────────────────────

  it('heading with trailing whitespace parses correctly', () => {
    const md = '## Risk Factors   \n\nRisk body.';
    const result = service.parse(md);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.title).toBe('Risk Factors');
    expect(result.chunks[0]!.sectionPath).toEqual(['Risk Factors']);
  });

  it('heading with extra spaces after # parses correctly', () => {
    const md = '#   Extra Spaces\n\nContent.';
    const result = service.parse(md);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.title).toBe('Extra Spaces');
  });

  // ── Setext headings ──────────────────────────────────────────────────────

  it('setext H1 (=== underline) is recognized as H1', () => {
    const md = 'Report Title\n============\n\nBody text here.';
    const result = service.parse(md);

    expect(result.sourceFormat).toBe('markdown');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.sectionPath).toEqual(['Report Title']);
    expect(result.chunks[0]!.title).toBe('Report Title');
  });

  it('setext H2 (--- underline) is recognized as H2', () => {
    const md = '# Chapter\n\nSubsection\n-----------\n\nSub body.';
    const result = service.parse(md);

    const subChunk = result.chunks.find((c) => c.text === 'Sub body.');
    expect(subChunk).toBeDefined();
    expect(subChunk!.sectionPath).toEqual(['Chapter', 'Subsection']);
  });

  // ── 5-section document order ─────────────────────────────────────────────

  it('five-section markdown yields five chunks in document order', () => {
    const sections = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
    const md = sections
      .map((s, i) => `## ${s}\n\nBody ${i + 1}.`)
      .join('\n\n');

    const result = service.parse(md);

    expect(result.chunks).toHaveLength(5);
    result.chunks.forEach((chunk, i) => {
      expect(chunk.text).toBe(`Body ${i + 1}.`);
      expect(chunk.title).toBe(sections[i]);
    });
  });

  // ── pageStart / pageEnd always null ─────────────────────────────────────

  it('pageStart and pageEnd are always null for markdown input', () => {
    const md = '# Title\n\nContent.';
    const result = service.parse(md);

    for (const chunk of result.chunks) {
      expect(chunk.pageStart).toBeNull();
      expect(chunk.pageEnd).toBeNull();
    }
  });

  // ── parentId always null at parse time ──────────────────────────────────

  it('parentId is null at parse time for all chunks', () => {
    const md = '# Title\n\nContent.';
    const result = service.parse(md);

    for (const chunk of result.chunks) {
      expect(chunk.parentId).toBeNull();
    }
  });
});
