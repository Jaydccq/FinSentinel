/**
 * rag-backfill-representation-sparse.cli.ts
 *
 * Backfill `search_vector` on existing `document_chunk_representations` rows
 * that were written before R2.2 shipped the insert-time tsvector helper.
 *
 * Reuses `buildRepresentationTsvector()` from
 * `../chunk-representation.tsvector` — NO LLM calls, NO embedding recompute,
 * NO other columns touched. Only the `search_vector` column is updated,
 * and only where it is currently NULL.
 *
 * Usage (from apps/api/):
 *   pnpm rag:backfill:sparse [options]
 *
 * Options:
 *   --dry-run                       Count candidate rows; print summary; no writes.
 *   --batch-size <N>                Rows per SELECT + per UPDATE batch. Default 500.
 *                                   Must be a positive integer; 0/NaN rejected.
 *   --representation-type <type>    Restrict to a single representation type.
 *                                   One of: contextual_text, sample_question,
 *                                   summary, keyword_entity.
 *   --progress-every <N>            Emit a progress log every N batches. Default 1.
 *
 * Deliberately NOT offered: `--where <sql>`. Raw SQL predicates are too easy
 * to misuse (operator quoting errors, injection surface). Operators who need
 * more complex filtering should edit the CLI source.
 *
 * Safety:
 *   - Refuses to run against a non-ephemeral DB unless
 *     SPARSE_BACKFILL_CONFIRM=1 (or FIXTURE_SEED_CONFIRM=1 for parity with
 *     the seed-fixture allow-list).
 *   - Dry-run bypasses the guard and prints only.
 *
 * Idempotency: the SELECT filter is `search_vector IS NULL`, so re-running
 * the CLI after a full backfill updates zero rows.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '@finsentinel/db';
import { REPRESENTATION_TYPES, type RepresentationType } from '@finsentinel/db';
import { AppConfigModule, DatabaseModule } from '../../config';
import { buildRepresentationTsvector } from '../chunk-representation.tsvector';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BackfillCliArgs {
  dryRun: boolean;
  batchSize: number;
  representationType: RepresentationType | undefined;
  progressEveryBatches: number;
}

/**
 * Shape of a row fetched for backfill. The caller is expected to LEFT JOIN
 * `document_chunks` so the A/B/C-weighted fields live on the row directly —
 * no N+1 query per row.
 */
export interface RepresentationRowForBackfill {
  id: string;
  representationType: RepresentationType;
  representationContent: string;
  chunkTitle: string | null;
  chunkSectionPath: string | null;
  chunkContent: string | null;
}

export type BackfillRowFetcher = (
  limit: number,
) => Promise<RepresentationRowForBackfill[]>;

export type BackfillRowUpdater = (id: string, fragment: SQL<unknown>) => Promise<void>;

export interface BackfillProgressLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface BackfillSummary {
  candidatesScanned: number;
  rowsUpdated: number;
  batchesProcessed: number;
}

export interface GuardEnv {
  databaseUrl: string;
  nodeEnv: string | undefined;
  sparseBackfillConfirm: string | undefined;
  fixtureSeedConfirm: string | undefined;
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_PROGRESS_EVERY = 1;

const KNOWN_FLAGS = new Set([
  '--dry-run',
  '--batch-size',
  '--representation-type',
  '--progress-every',
]);

function parsePositiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(
      `Invalid value for ${flag}: ${JSON.stringify(raw)} — expected a positive integer.`,
    );
  }
  return n;
}

export function parseBackfillArgs(argv: string[]): BackfillCliArgs {
  const args: BackfillCliArgs = {
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
    representationType: undefined,
    progressEveryBatches: DEFAULT_PROGRESS_EVERY,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--batch-size' && argv[i + 1] !== undefined) {
      args.batchSize = parsePositiveInt('--batch-size', argv[++i]!);
    } else if (a === '--representation-type' && argv[i + 1] !== undefined) {
      const raw = argv[++i]!;
      if (!REPRESENTATION_TYPES.includes(raw as RepresentationType)) {
        throw new Error(
          `Invalid value for --representation-type: ${JSON.stringify(raw)}. ` +
            `Expected one of ${REPRESENTATION_TYPES.join(', ')}.`,
        );
      }
      args.representationType = raw as RepresentationType;
    } else if (a === '--progress-every' && argv[i + 1] !== undefined) {
      args.progressEveryBatches = parsePositiveInt('--progress-every', argv[++i]!);
    } else if (a.startsWith('--')) {
      throw new Error(
        `unrecognized flag: ${a}. Known flags: ${[...KNOWN_FLAGS].join(', ')}`,
      );
    } else {
      throw new Error(`unrecognized positional argument: ${a}`);
    }
  }

  return args;
}

// ── Production guard ──────────────────────────────────────────────────────────

export function isObviouslyEphemeralDb(url: string): boolean {
  // Same conservative allow-list as seed-fixture.cli.ts.
  if (/@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url)) return true;
  if (/\/(finsentinel_test|finsentinel_ci|finsentinel_ephemeral)(\?|$)/.test(url)) return true;
  return false;
}

export function guardProductionAccidents(env: GuardEnv): void {
  if (env.nodeEnv === 'test') return;
  if (isObviouslyEphemeralDb(env.databaseUrl)) return;
  if (env.sparseBackfillConfirm === '1') return;
  // Parity with seed-fixture: operators often already have this one exported.
  if (env.fixtureSeedConfirm === '1') return;

  throw new Error(
    `Refusing to backfill search_vector into a non-ephemeral database.\n` +
      `DATABASE_URL does not look local/test (got host pattern not in allow-list) ` +
      `and NODE_ENV is not 'test'.\n` +
      `If you really mean to backfill this DB, set SPARSE_BACKFILL_CONFIRM=1.`,
  );
}

// ── Core loop (pure — DI'd fetcher + updater for testability) ─────────────────

export interface BackfillRunOptions {
  fetchBatch: BackfillRowFetcher;
  updateRow: BackfillRowUpdater;
  batchSize: number;
  dryRun: boolean;
  progressEveryBatches: number;
  logger: BackfillProgressLogger;
}

export async function backfillSparseSearchVectors(
  opts: BackfillRunOptions,
): Promise<BackfillSummary> {
  const { fetchBatch, updateRow, batchSize, dryRun, progressEveryBatches, logger } = opts;
  let candidatesScanned = 0;
  let rowsUpdated = 0;
  let batchesProcessed = 0;

  // Stream batches until the fetcher returns fewer rows than requested
  // (i.e. the candidate set is drained). Every fetch re-scans against
  // `search_vector IS NULL`, so on wet-run the next fetch never re-sees
  // a row we just updated. On dry-run the row is still NULL so the fetcher
  // would loop forever on the same batch — we guard against that by using
  // an LLM-less, keyset-style offset via the DB cursor (id). The runtime
  // path we control (main()) passes a fetcher that uses an id-cursor for
  // dry-run; the test doubles return [] after the first fetch to signal
  // end-of-stream.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await fetchBatch(batchSize);
    if (batch.length === 0) break;
    candidatesScanned += batch.length;
    batchesProcessed++;

    if (!dryRun) {
      for (const row of batch) {
        const fragment = buildRepresentationTsvector(row.representationType, {
          title: row.chunkTitle,
          sectionPath: row.chunkSectionPath,
          chunkContent: row.chunkContent,
          representationContent: row.representationContent,
        });
        await updateRow(row.id, fragment);
        rowsUpdated++;
      }
    }

    if (batchesProcessed % progressEveryBatches === 0) {
      logger.info(
        `[backfill-sparse] batch ${batchesProcessed} — ${rowsUpdated} updated, ` +
          `${candidatesScanned} scanned` +
          (dryRun ? ' (dry-run)' : ''),
      );
    }

    // If the fetcher returned fewer rows than we asked for, the candidate
    // set is drained.
    if (batch.length < batchSize) break;
  }

  return { candidatesScanned, rowsUpdated, batchesProcessed };
}

// ── DB wiring (runtime only — not used by unit tests) ─────────────────────────

/**
 * Build a fetcher that SELECTs the next `limit` rows with `search_vector IS NULL`,
 * optionally filtered by representation_type. Always orders by `id` so the
 * dry-run path is deterministic. For dry-run we use a keyset cursor so we
 * don't re-see the same rows (UPDATE doesn't happen). For wet-run, the
 * UPDATE removes rows from the candidate set, so a plain repeated SELECT
 * of the first N rows also terminates.
 */
function buildDbFetcher(
  db: DrizzleDB,
  representationType: RepresentationType | undefined,
  dryRun: boolean,
): BackfillRowFetcher {
  let lastId: string | null = null;

  return async (limit: number) => {
    const typeFilter = representationType
      ? sql`AND rep.representation_type = ${representationType}`
      : sql``;
    const cursorFilter = dryRun && lastId ? sql`AND rep.id > ${lastId}` : sql``;

    const rows = await db.execute<{
      id: string;
      representation_type: RepresentationType;
      representation_content: string;
      chunk_meta_title: string | null;
      chunk_section_path: string | null;
      chunk_content: string | null;
    }>(sql`
      SELECT
        rep.id AS id,
        rep.representation_type AS representation_type,
        rep.content AS representation_content,
        chunk.meta_title AS chunk_meta_title,
        chunk.section_path AS chunk_section_path,
        chunk.content AS chunk_content
      FROM document_chunk_representations rep
      LEFT JOIN document_chunks chunk ON chunk.id = rep.chunk_id
      WHERE rep.search_vector IS NULL
      ${typeFilter}
      ${cursorFilter}
      ORDER BY rep.id
      LIMIT ${limit}
    `);

    const arr = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
    const mapped = (arr as Array<{
      id: string;
      representation_type: RepresentationType;
      representation_content: string;
      chunk_meta_title: string | null;
      chunk_section_path: string | null;
      chunk_content: string | null;
    }>).map((r) => ({
      id: r.id,
      representationType: r.representation_type,
      representationContent: r.representation_content,
      chunkTitle: r.chunk_meta_title,
      chunkSectionPath: r.chunk_section_path,
      chunkContent: r.chunk_content,
    }));

    if (dryRun && mapped.length > 0) {
      lastId = mapped[mapped.length - 1]!.id;
    }

    return mapped;
  };
}

function buildDbUpdater(db: DrizzleDB): BackfillRowUpdater {
  return async (id, fragment) => {
    await db.execute(sql`
      UPDATE document_chunk_representations
      SET search_vector = ${fragment}
      WHERE id = ${id}
        AND search_vector IS NULL
    `);
  };
}

// ── NestJS bootstrap module (only for runtime; tests bypass this) ─────────────

@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [],
})
class BackfillSparseCliModule {}

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

async function main(): Promise<void> {
  const cliArgs = parseBackfillArgs(process.argv.slice(2));

  console.log(
    `[backfill-sparse] batch_size=${cliArgs.batchSize} ` +
      `representation_type=${cliArgs.representationType ?? '<all>'} ` +
      `dry_run=${cliArgs.dryRun} ` +
      `progress_every=${cliArgs.progressEveryBatches}`,
  );

  requireDatabaseUrl();

  if (!cliArgs.dryRun) {
    guardProductionAccidents({
      databaseUrl: process.env['DATABASE_URL'] ?? '',
      nodeEnv: process.env['NODE_ENV'],
      sparseBackfillConfirm: process.env['SPARSE_BACKFILL_CONFIRM'],
      fixtureSeedConfirm: process.env['FIXTURE_SEED_CONFIRM'],
    });
  }

  const app = await NestFactory.createApplicationContext(BackfillSparseCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const db = app.get<DrizzleDB>('DRIZZLE_DB');
    const summary = await backfillSparseSearchVectors({
      fetchBatch: buildDbFetcher(db, cliArgs.representationType, cliArgs.dryRun),
      updateRow: buildDbUpdater(db),
      batchSize: cliArgs.batchSize,
      dryRun: cliArgs.dryRun,
      progressEveryBatches: cliArgs.progressEveryBatches,
      logger: {
        info: (msg) => console.log(msg),
        warn: (msg) => console.warn(msg),
      },
    });

    console.log('');
    console.log('rag:backfill:sparse');
    console.log('-------------------');
    console.log(`Candidates scanned : ${summary.candidatesScanned}`);
    console.log(`Rows updated       : ${summary.rowsUpdated}`);
    console.log(`Batches processed  : ${summary.batchesProcessed}`);
    if (cliArgs.dryRun) {
      console.log('[dry-run] No UPDATEs were issued. Drop --dry-run to write.');
    }
  } finally {
    await app.close();
  }
}

// Only run main() when this file is the direct entrypoint. Tests import
// helpers without triggering the bootstrap.
const isEntrypoint = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((err) => {
    console.error('[backfill-sparse] FAILED:', err);
    // eslint-disable-next-line no-magic-numbers
    process.exit(2);
  });
}
