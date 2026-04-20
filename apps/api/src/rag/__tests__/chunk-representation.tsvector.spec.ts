import { describe, it, expect } from 'vitest';
import { buildRepresentationTsvector } from '../chunk-representation.tsvector';

/**
 * Unit tests for the field-weighted tsvector helper used by
 * ChunkRepresentationService on INSERT. The helper returns a Drizzle
 * `sql``` fragment; we introspect the template chunks to verify the
 * tsvector shape without relying on a live Postgres.
 */

function sqlToText(fragment: unknown): string {
  if (!fragment || typeof fragment !== 'object') return String(fragment);
  const f = fragment as { queryChunks?: unknown[]; chunks?: unknown[] };
  const chunks = f.queryChunks ?? f.chunks ?? [];
  // Drizzle `sql`` fragments alternate between StringChunk ({value: [string]})
  // and parameter values. Literals contain the template text; anything else is
  // a bound parameter that should be rendered as a placeholder, not inlined
  // (so tests can't accidentally assert on user-supplied text).
  return chunks
    .map((c) => {
      if (c && typeof c === 'object') {
        const rec = c as { value?: unknown };
        if (Array.isArray(rec.value) && rec.value.every((v) => typeof v === 'string')) {
          return (rec.value as string[]).join('');
        }
        return '<<param>>';
      }
      return '<<param>>';
    })
    .join('');
}

describe('buildRepresentationTsvector', () => {
  const inputs = {
    title: 'Apple Q4 2025 Earnings',
    sectionPath: 'Financial Results > Revenue',
    chunkContent: 'Apple Inc. reported Q4 2025 revenue of $119.58 billion.',
    representationContent: 'Revenue grew 15% YoY to $119.58B.',
  };

  it.each([
    'contextual_text' as const,
    'sample_question' as const,
    'summary' as const,
    'keyword_entity' as const,
  ])('uses to_tsvector(simple) + setweight for representation type %s', (type) => {
    const fragment = buildRepresentationTsvector(type, inputs);
    const text = sqlToText(fragment);

    expect(text.toLowerCase()).toContain(`to_tsvector('simple'`);
    expect(text.toLowerCase()).toContain('setweight');
    // Never use the english config — would break the sparse-search tsquery match.
    expect(text.toLowerCase()).not.toContain(`to_tsvector('english'`);
  });

  it('parameterises all user inputs (no raw string interpolation)', () => {
    const fragment = buildRepresentationTsvector('contextual_text', {
      title: "O'Malley & Co.",            // contains single quote
      sectionPath: 'foo $$ bar',          // contains dollar-quote delimiter
      chunkContent: 'line 1\\nbackslash', // contains backslash
      representationContent: '"nested"',  // contains double quote
    });
    const text = sqlToText(fragment);
    // None of the raw characters should leak into the SQL text — they must be
    // carried through as parameters (rendered as <<param>> by sqlToText).
    expect(text).not.toContain("O'Malley");
    expect(text).not.toContain('$$');
    expect(text).not.toContain('backslash');
    expect(text).not.toContain('nested');
    expect(text).toContain('<<param>>');
  });

  it('contextual_text layout: title + section_path at A, rep content at B, chunk tail at C', () => {
    const fragment = buildRepresentationTsvector('contextual_text', inputs);
    const text = sqlToText(fragment);
    // Expect three weight slots A/B/C somewhere in the fragment.
    expect(text).toContain("'A'");
    expect(text).toContain("'B'");
    expect(text).toContain("'C'");
  });

  it('sample_question layout: questions at A, chunk snippet at B', () => {
    const fragment = buildRepresentationTsvector('sample_question', inputs);
    const text = sqlToText(fragment);
    expect(text).toContain("'A'");
    expect(text).toContain("'B'");
  });

  it('summary layout: summary at A, title at C', () => {
    const fragment = buildRepresentationTsvector('summary', inputs);
    const text = sqlToText(fragment);
    expect(text).toContain("'A'");
    expect(text).toContain("'C'");
  });

  it('keyword_entity layout: keywords at A, title at C', () => {
    const fragment = buildRepresentationTsvector('keyword_entity', inputs);
    const text = sqlToText(fragment);
    expect(text).toContain("'A'");
    expect(text).toContain("'C'");
  });

  it('handles null title / sectionPath / chunkContent without throwing', () => {
    expect(() =>
      buildRepresentationTsvector('contextual_text', {
        title: null,
        sectionPath: null,
        chunkContent: null,
        representationContent: 'only contextual prose',
      }),
    ).not.toThrow();
  });
});
