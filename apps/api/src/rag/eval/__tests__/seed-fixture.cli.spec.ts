/**
 * seed-fixture.cli.spec.ts
 *
 * Unit tests for the rag:eval:seed-fixture CLI. Exercises pure helpers
 * (corpus load/group, deterministic UUID mapping, dry-run counting, stub
 * embedding shape) without needing a live Postgres.
 *
 * Integration-style DB seeding tests are gated behind DATABASE_URL and are
 * skipped in the default run — see the `describe.skipIf` block at the bottom.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CORPUS_CHUNK_ID_NAMESPACE,
  CORPUS_SOURCE_DOC_NAMESPACE,
  STUB_EMBEDDING_DIM,
  buildStubEmbedding,
  deterministicChunkUuid,
  deterministicDocumentUuid,
  groupCorpusByDocument,
  loadCorpusFromFile,
  parseCliArgs,
} from '../seed-fixture.cli';
import { resolve } from 'node:path';

const FIXTURE_CORPUS = resolve(
  __dirname,
  '../../../../../../services/evaluation-runner/datasets/corpus.json',
);

// ── parseCliArgs ──────────────────────────────────────────────────────────────

describe('parseCliArgs', () => {
  it('returns sensible defaults when argv is empty', () => {
    const args = parseCliArgs([]);
    expect(args.stubEmbeddings).toBe(true);
    // Default polarity: enrichment NOT attempted. Operator must opt in
    // with --with-enrichment to surface the stub NOTE.
    expect(args.withEnrichment).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.outputSummary).toBeUndefined();
    // corpusPath default points at the fixture corpus relative to repo root
    expect(args.corpusPath).toMatch(/services\/evaluation-runner\/datasets\/corpus\.json$/);
  });

  it('honours --dry-run', () => {
    expect(parseCliArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('honours --with-enrichment', () => {
    expect(parseCliArgs(['--with-enrichment']).withEnrichment).toBe(true);
  });

  it('--skip-enrichment still parses but emits a deprecation warning on stderr', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const args = parseCliArgs(['--skip-enrichment']);
      // It's a no-op now — default (false) is preserved.
      expect(args.withEnrichment).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toMatch(/--skip-enrichment is deprecated/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('--use-real-embeddings flips stubEmbeddings off', () => {
    expect(parseCliArgs(['--use-real-embeddings']).stubEmbeddings).toBe(false);
  });

  it('--no-stub-embeddings flips stubEmbeddings off', () => {
    expect(parseCliArgs(['--no-stub-embeddings']).stubEmbeddings).toBe(false);
  });

  it('accepts --corpus <path> and --output-summary <path>', () => {
    const args = parseCliArgs(['--corpus', '/tmp/c.json', '--output-summary', '/tmp/s.json']);
    expect(args.corpusPath).toBe('/tmp/c.json');
    expect(args.outputSummary).toBe('/tmp/s.json');
  });
});

// ── buildStubEmbedding ─────────────────────────────────────────────────────────

describe('buildStubEmbedding', () => {
  it('returns a vector of the configured dimension', () => {
    const vec = buildStubEmbedding('chunk-001');
    expect(vec).toHaveLength(STUB_EMBEDDING_DIM);
  });

  it('is deterministic for the same key', () => {
    expect(buildStubEmbedding('chunk-001')).toEqual(buildStubEmbedding('chunk-001'));
  });

  it('differs for different keys (basic uniqueness sanity check)', () => {
    const a = buildStubEmbedding('chunk-001');
    const b = buildStubEmbedding('chunk-002');
    // Not equal across all positions — guards against a constant-only stub
    // that would collapse all lanes to the same vector.
    const allEqual = a.every((x, i) => x === b[i]);
    expect(allEqual).toBe(false);
  });

  it('all components are finite numbers', () => {
    const vec = buildStubEmbedding('chunk-001');
    for (const v of vec) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ── Deterministic UUIDs ────────────────────────────────────────────────────────

describe('deterministicChunkUuid / deterministicDocumentUuid', () => {
  it('maps the same chunk_id to the same UUID on every call', () => {
    expect(deterministicChunkUuid('chunk-001')).toBe(deterministicChunkUuid('chunk-001'));
  });

  it('produces syntactically valid UUIDs', () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(deterministicChunkUuid('chunk-001')).toMatch(uuidRe);
    expect(deterministicDocumentUuid('AAPL-10K-2025.pdf')).toMatch(uuidRe);
  });

  it('chunk + document namespaces are disjoint', () => {
    // Even if someone were to pass the same string, the two namespaces must
    // produce different UUIDs so a chunk UUID never collides with a doc UUID.
    expect(deterministicChunkUuid('foo')).not.toBe(deterministicDocumentUuid('foo'));
  });

  it('exposes the two namespaces as separate constants', () => {
    expect(CORPUS_CHUNK_ID_NAMESPACE).not.toEqual(CORPUS_SOURCE_DOC_NAMESPACE);
  });
});

// ── Corpus load + group ───────────────────────────────────────────────────────

describe('loadCorpusFromFile + groupCorpusByDocument', () => {
  it('loads the fixture corpus with the expected shape', () => {
    const { entries } = loadCorpusFromFile(FIXTURE_CORPUS);
    expect(entries.length).toBeGreaterThan(0);
    const first = entries[0]!;
    expect(first.chunk_id).toMatch(/^chunk-\d+$/);
    expect(typeof first.source_doc).toBe('string');
    expect(typeof first.content).toBe('string');
    expect(typeof first.doc_type).toBe('string');
    expect(typeof first.sector).toBe('string');
  });

  it('groupCorpusByDocument groups entries by source_doc in stable order', () => {
    const { entries } = loadCorpusFromFile(FIXTURE_CORPUS);
    const grouped = groupCorpusByDocument(entries);

    // Every group's entries must share the same source_doc
    for (const group of grouped) {
      expect(group.chunks.every((c) => c.source_doc === group.sourceDoc)).toBe(true);
    }

    // Every chunk in the corpus must end up in exactly one group
    const totalChunks = grouped.reduce((acc, g) => acc + g.chunks.length, 0);
    expect(totalChunks).toBe(entries.length);

    // Grouping is deterministic for a second call on identical input
    const again = groupCorpusByDocument(entries);
    expect(again.map((g) => g.sourceDoc)).toEqual(grouped.map((g) => g.sourceDoc));
  });

  it('each group has a stable deterministic document UUID', () => {
    const { entries } = loadCorpusFromFile(FIXTURE_CORPUS);
    const grouped = groupCorpusByDocument(entries);
    for (const group of grouped) {
      expect(group.documentId).toBe(deterministicDocumentUuid(group.sourceDoc));
    }
  });
});
