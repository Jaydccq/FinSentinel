/**
 * seed-fixture.cli.ts
 *
 * Hydrates a Postgres database with the fixture corpus (datasets/corpus.json)
 * so the CI eval gate has real `documents` + `document_chunks` rows to score
 * against. Without this, the evaluator's live-API path would run against an
 * empty DB and the gate would be meaningless.
 *
 * Usage (from apps/api/):
 *   pnpm rag:eval:seed-fixture [--corpus <path>] [--dry-run]
 *     [--stub-embeddings | --no-stub-embeddings | --use-real-embeddings]
 *     [--with-enrichment] [--output-summary <path>]
 *
 * Defaults:
 *   - corpus:            services/evaluation-runner/datasets/corpus.json
 *   - stub-embeddings:   true (fast CI path; no OpenRouter call)
 *   - with-enrichment:   false (representation enrichment is a documented
 *                        stub — opt in with --with-enrichment to surface
 *                        the NOTE reminding you to run the backfill CLI)
 *
 * Deprecated: `--skip-enrichment` is accepted as a no-op alias to avoid
 * breaking existing CI during the transition. It prints a one-line
 * deprecation warning on stderr. Remove after the next release cut.
 *
 * Idempotency: on rerun the CLI DELETEs all rows whose deterministic
 * document UUIDs match the corpus and re-inserts them. Every run ends
 * with the same state regardless of prior content.
 *
 * Safety: production accidents are guarded. When NODE_ENV !== 'test' and
 * DATABASE_URL does not look ephemeral (localhost / finsentinel_test /
 * 127.0.0.1), require FIXTURE_SEED_CONFIRM=1 before writing.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, type Type } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '@finsentinel/db';
import { RagChunkStoreService } from '../rag-chunk-store.service';
import { RagEmbeddingService } from '../rag-embedding.service';

// ── Constants ─────────────────────────────────────────────────────────────────

// Two disjoint "namespaces" (32-byte seeds) used to derive deterministic
// UUIDs from corpus strings. These are NOT UUIDv5 namespace UUIDs — instead
// we SHA-256 the seed + key and format the first 16 bytes as a UUID. That
// avoids a uuid/v5 dependency while being equally deterministic.
export const CORPUS_CHUNK_ID_NAMESPACE = 'finsentinel:corpus-fixture:chunk-id';
export const CORPUS_SOURCE_DOC_NAMESPACE = 'finsentinel:corpus-fixture:source-doc';

/**
 * Embedding dimension for stub vectors. Matches the canonical provider:
 * NVIDIA `nvidia/llama-nemotron-embed-1b-v2` at 2048 dims. This is the
 * dimension `document_chunk_representations.embedding` is declared with
 * after V16 (+ V22 bridge), so stub embeddings inserted into
 * `document_chunks` during fixture seeding remain shape-compatible
 * with the representation lane.
 *
 * If you swap the embedding provider (e.g. OpenAI text-embedding-3-small
 * at 1536 dims), set this AND run a migration narrowing the column —
 * seed-fixture and DB schema must agree.
 */
export const STUB_EMBEDDING_DIM = 2048;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CorpusEntry {
  chunk_id: string;
  source_doc: string;
  doc_type: string;
  sector: string;
  content: string;
}

interface CorpusFile {
  version?: string;
  created_at?: string;
  description?: string;
  chunks: CorpusEntry[];
}

export interface LoadedCorpus {
  entries: CorpusEntry[];
  path: string;
}

export interface CorpusDocumentGroup {
  sourceDoc: string;
  documentId: string; // deterministic UUID
  chunks: CorpusEntry[];
}

export interface SeedFixtureCliArgs {
  corpusPath: string;
  stubEmbeddings: boolean;
  /**
   * Whether to print the enrichment NOTE / attempt enrichment drain.
   * Default: false. Opt in with `--with-enrichment`. The flag is named
   * with positive polarity so the default behaviour is the safe one:
   * the CLI does NOT claim to have run enrichment.
   */
  withEnrichment: boolean;
  dryRun: boolean;
  outputSummary: string | undefined;
}

export interface SeedSummary {
  corpusPath: string;
  documentCount: number;
  chunkCount: number;
  groups: Array<{ sourceDoc: string; documentId: string; chunkCount: number }>;
  stubEmbeddings: boolean;
  withEnrichment: boolean;
  dryRun: boolean;
}

// ── Path helpers (default corpus resolves relative to repo root) ──────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../../..');
const DEFAULT_CORPUS = resolve(REPO_ROOT, 'services/evaluation-runner/datasets/corpus.json');

// ── Arg parsing ───────────────────────────────────────────────────────────────

export function parseCliArgs(argv: string[]): SeedFixtureCliArgs {
  const args: SeedFixtureCliArgs = {
    corpusPath: DEFAULT_CORPUS,
    stubEmbeddings: true,
    withEnrichment: false,
    dryRun: false,
    outputSummary: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--with-enrichment') {
      args.withEnrichment = true;
    } else if (a === '--skip-enrichment') {
      // Deprecated alias: enrichment is now OFF by default, so --skip-enrichment
      // is a no-op. Keep it parsing without error so existing CI doesn't break
      // during the transition, but warn the operator on stderr.
      console.warn(
        '[seed-fixture][WARN] --skip-enrichment is deprecated and now the default; remove it from your invocation.',
      );
    } else if (a === '--stub-embeddings') {
      args.stubEmbeddings = true;
    } else if (a === '--no-stub-embeddings' || a === '--use-real-embeddings') {
      args.stubEmbeddings = false;
    } else if (a === '--corpus' && argv[i + 1]) {
      args.corpusPath = argv[++i]!;
    } else if (a === '--output-summary' && argv[i + 1]) {
      args.outputSummary = argv[++i]!;
    }
  }

  return args;
}

// ── Deterministic UUID helpers ────────────────────────────────────────────────

function sha256Uuid(namespace: string, key: string): string {
  const h = createHash('sha256').update(`${namespace}\0${key}`).digest('hex');
  // Format first 32 hex chars as a UUID. Upper bits of the version nibble set
  // to 4 to keep it a syntactically valid UUIDv4 string. (Collision risk is
  // irrelevant at our scale.)
  const a = h.slice(0, 8);
  const b = h.slice(8, 12);
  // version 4
  const c = '4' + h.slice(13, 16);
  // variant 10xx
  const variant = (parseInt(h.slice(16, 17), 16) & 0x3) | 0x8;
  const d = variant.toString(16) + h.slice(17, 20);
  const e = h.slice(20, 32);
  return `${a}-${b}-${c}-${d}-${e}`;
}

export function deterministicChunkUuid(chunkId: string): string {
  return sha256Uuid(CORPUS_CHUNK_ID_NAMESPACE, chunkId);
}

export function deterministicDocumentUuid(sourceDoc: string): string {
  return sha256Uuid(CORPUS_SOURCE_DOC_NAMESPACE, sourceDoc);
}

// ── Stub embedding ─────────────────────────────────────────────────────────────

/**
 * Deterministic stub embedding keyed on a string. Produces a unit-ish vector
 * of `STUB_EMBEDDING_DIM` floats in [-0.05, 0.05] that differs per key so
 * ANN plumbing is exercised (no trivial all-zero or all-same vectors). Never
 * calls OpenRouter.
 */
export function buildStubEmbedding(key: string): number[] {
  const seed = createHash('sha256').update(`stub-embedding:${key}`).digest();
  // Cycle through the 32-byte seed to fill STUB_EMBEDDING_DIM floats. Map
  // each byte to [-0.05, 0.05] — small enough that cosine similarity stays
  // well-behaved.
  const vec = new Array<number>(STUB_EMBEDDING_DIM);
  for (let i = 0; i < STUB_EMBEDDING_DIM; i++) {
    const byte = seed[i % seed.length]!;
    vec[i] = (byte / 255) * 0.1 - 0.05;
  }
  return vec;
}

// ── Corpus loading + grouping ──────────────────────────────────────────────────

export function loadCorpusFromFile(path: string): LoadedCorpus {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as CorpusFile;
  if (!Array.isArray(parsed.chunks)) {
    throw new Error(`Corpus file at ${path} is missing a 'chunks' array`);
  }
  return { entries: parsed.chunks, path };
}

export function groupCorpusByDocument(entries: CorpusEntry[]): CorpusDocumentGroup[] {
  const byDoc = new Map<string, CorpusEntry[]>();
  for (const entry of entries) {
    const list = byDoc.get(entry.source_doc);
    if (list) {
      list.push(entry);
    } else {
      byDoc.set(entry.source_doc, [entry]);
    }
  }

  // Insertion-order Map preserves first-occurrence order; good enough for
  // determinism. We don't sort — corpus.json dictates the order.
  const groups: CorpusDocumentGroup[] = [];
  for (const [sourceDoc, chunks] of byDoc.entries()) {
    groups.push({
      sourceDoc,
      documentId: deterministicDocumentUuid(sourceDoc),
      chunks,
    });
  }
  return groups;
}

// ── DB safety guard ────────────────────────────────────────────────────────────

function isObviouslyEphemeralDb(url: string): boolean {
  // Conservative allow-list: localhost / 127.0.0.1 / a URL that clearly names
  // a test DB. CI runners typically hit localhost via the Postgres service
  // container, so this is the expected happy path.
  if (/@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url)) return true;
  if (/\/(finsentinel_test|finsentinel_ci|finsentinel_ephemeral)(\?|$)/.test(url)) return true;
  return false;
}

function guardProductionAccidents(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv === 'test') return;
  if (isObviouslyEphemeralDb(url)) return;
  if (process.env['FIXTURE_SEED_CONFIRM'] === '1') return;

  throw new Error(
    `Refusing to seed fixture corpus into a non-ephemeral database.\n` +
      `DATABASE_URL does not look local/test (got host pattern not in allow-list) ` +
      `and NODE_ENV is not 'test'.\n` +
      `If you really mean to seed this DB, set FIXTURE_SEED_CONFIRM=1.`,
  );
}

// ── Seed logic ─────────────────────────────────────────────────────────────────

export interface SeedRunDeps {
  db: DrizzleDB;
  chunkStore: RagChunkStoreService;
  embedder: RagEmbeddingService;
}

async function resolveEmbeddings(
  deps: SeedRunDeps,
  chunks: CorpusEntry[],
  stub: boolean,
): Promise<number[][]> {
  if (stub) {
    return chunks.map((c) => buildStubEmbedding(c.chunk_id));
  }
  // Real embedding path — batches all chunk contents in one call.
  return deps.embedder.embedChunks(chunks.map((c) => c.content));
}

async function seedOneDocumentGroup(
  deps: SeedRunDeps,
  group: CorpusDocumentGroup,
  stub: boolean,
): Promise<void> {
  // Upsert the parent document row. We use raw SQL to avoid the postgres.js
  // mixed-default INSERT bug flagged in CLAUDE.md. ON CONFLICT (id) makes
  // this idempotent on rerun.
  await deps.db.execute(sql`
    INSERT INTO documents (
      id, file_name, original_file_name, doc_type, status, sector,
      region_id, user_id, file_size, chunk_count, storage_key,
      storage_tier, archived_at, created_at
    ) VALUES (
      ${group.documentId},
      ${group.sourceDoc},
      ${group.sourceDoc},
      ${group.chunks[0]!.doc_type},
      'READY',
      ${group.chunks[0]!.sector},
      'US',
      NULL,
      NULL,
      ${group.chunks.length},
      NULL,
      'HOT',
      NULL,
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      doc_type = EXCLUDED.doc_type,
      sector = EXCLUDED.sector,
      chunk_count = EXCLUDED.chunk_count,
      status = 'READY'
  `);

  const embeddings = await resolveEmbeddings(deps, group.chunks, stub);

  await deps.chunkStore.replaceChunks(
    'document',
    group.documentId,
    group.chunks.map((entry, i) => ({
      content: entry.content,
      embedding: embeddings[i]!,
      metadata: {
        corpus_chunk_id: entry.chunk_id, // stable back-reference to corpus.json
        source_doc: entry.source_doc,
        doc_type: entry.doc_type,
        sector: entry.sector,
        region_id: 'US',
      },
      sectionPath: null,
      title: entry.source_doc,
    })),
  );
}

// ── Bootstrap module ──────────────────────────────────────────────────────────

async function createSeedFixtureCliModule(): Promise<Type<unknown>> {
  const { AppConfigModule, DatabaseModule } = await import('../../config');

  @Module({
    imports: [AppConfigModule, DatabaseModule],
    providers: [RagChunkStoreService, RagEmbeddingService],
  })
  class SeedFixtureCliModule {}

  return SeedFixtureCliModule;
}

// ── Main entrypoint ───────────────────────────────────────────────────────────

function requireDatabaseUrl(): void {
  if (!process.env['DATABASE_URL']) {
    console.error(
      'Error: DATABASE_URL environment variable is not set.\n' +
        'Set it to your local Postgres connection string, e.g.:\n' +
        '  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finsentinel',
    );
    process.exit(1);
  }
}

function emitSummary(summary: SeedSummary, outputPath: string | undefined): void {
  console.log(
    `[seed-fixture] corpus=${summary.corpusPath}\n` +
      `[seed-fixture]   documents=${summary.documentCount} chunks=${summary.chunkCount} ` +
      `stub_embeddings=${summary.stubEmbeddings} with_enrichment=${summary.withEnrichment} ` +
      `dry_run=${summary.dryRun}`,
  );
  for (const g of summary.groups) {
    console.log(`[seed-fixture]   - ${g.sourceDoc} (${g.chunkCount} chunks)`);
  }
  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    console.log(`[seed-fixture] summary JSON written to ${outputPath}`);
  }
}

async function main(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const { entries } = loadCorpusFromFile(cliArgs.corpusPath);
  const groups = groupCorpusByDocument(entries);

  const summary: SeedSummary = {
    corpusPath: cliArgs.corpusPath,
    documentCount: groups.length,
    chunkCount: entries.length,
    groups: groups.map((g) => ({
      sourceDoc: g.sourceDoc,
      documentId: g.documentId,
      chunkCount: g.chunks.length,
    })),
    stubEmbeddings: cliArgs.stubEmbeddings,
    withEnrichment: cliArgs.withEnrichment,
    dryRun: cliArgs.dryRun,
  };

  if (cliArgs.dryRun) {
    console.log('[seed-fixture] DRY RUN — no DB writes will be made');
    emitSummary(summary, cliArgs.outputSummary);
    // Ensure the `x would be inserted` accounting is visible
    console.log(
      `[seed-fixture] DRY RUN would insert ${summary.documentCount} documents ` +
        `and ${summary.chunkCount} chunks`,
    );
    return;
  }

  requireDatabaseUrl();
  guardProductionAccidents();

  const SeedFixtureCliModule = await createSeedFixtureCliModule();
  const app = await NestFactory.createApplicationContext(SeedFixtureCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const db = app.get<DrizzleDB>('DRIZZLE_DB');
    const chunkStore = app.get(RagChunkStoreService);
    const embedder = app.get(RagEmbeddingService);
    const deps: SeedRunDeps = { db, chunkStore, embedder };

    for (const group of groups) {
      console.log(
        `[seed-fixture] seeding ${group.sourceDoc} (${group.chunks.length} chunks, ` +
          `documentId=${group.documentId})`,
      );
      await seedOneDocumentGroup(deps, group, cliArgs.stubEmbeddings);
    }

    // Enrichment drain. Representation enrichment is a documented stub in
    // this CLI — the live API exercises it separately on its own document
    // pipeline. Default is OFF so we don't mislead operators into thinking
    // reps were populated. When opted in via --with-enrichment, surface the
    // stub warning on stderr with the pointer to the real backfill CLI.
    if (cliArgs.withEnrichment) {
      console.warn(
        '[seed-fixture][WARN] representation enrichment is a documented stub; ' +
          'use `pnpm --filter @finsentinel/api rag:backfill:representations` to ' +
          'populate reps against the seeded chunks.',
      );
    }

    emitSummary(summary, cliArgs.outputSummary);
    console.log('[seed-fixture] done');
  } finally {
    await app.close();
  }
}

// Guard against accidental execution in a test import — only run `main`
// when this file is the direct entrypoint.
const isEntrypoint = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((err) => {
    console.error('[seed-fixture] FAILED:', err);
    // eslint-disable-next-line no-magic-numbers
    process.exit(2);
  });
}
