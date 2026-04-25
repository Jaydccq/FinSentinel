/**
 * rag-backfill-chunk-issuer-tickers.cli.ts
 *
 * Backfill `tickers` (and optionally `issuerName`) into
 * `document_chunks.metadata` for historical rows that were ingested before
 * R4.0c shipped the insert-time extraction helper.
 *
 * R4.0c ensures every new chunk carries `metadata.tickers: string[]` (plus
 * `metadata.issuerName?: string`). This CLI walks the historical rows that
 * are missing those fields and writes the extracted values back into the
 * JSONB metadata column without touching any other key.
 *
 * Usage (from apps/api/):
 *   pnpm rag:backfill:chunk-issuer-tickers [options]
 *
 * Options:
 *   --dry-run                 Count candidate rows; print summary; no writes.
 *   --batch-size <N>          Rows per SELECT + UPDATE pass. Default 500.
 *                             Must be a positive integer; 0/NaN rejected.
 *   --progress-every <N>      Emit a progress log every N batches. Default 1.
 *   --force                   Override idempotency filter — rewrite rows even
 *                             if they already carry `tickers`.
 *
 * Deliberately NOT offered: `--where <sql>`. Raw SQL predicates are too easy
 * to misuse. Operators who need complex filtering should edit this source.
 *
 * Safety:
 *   - Refuses to run against a non-ephemeral DB unless
 *     CHUNK_TICKERS_BACKFILL_CONFIRM=1 (or FIXTURE_SEED_CONFIRM=1 for parity
 *     with the seed-fixture allow-list).
 *   - Dry-run bypasses the guard and prints only.
 *   - FIXTURE_SEED_CONFIRM=1 also bypasses the guard (parity with sparse CLI).
 *     Unlike fixture seeding, a --force backfill overwrites existing metadata
 *     and is NOT reversible without a DB snapshot — operators should not
 *     set both env vars in the same shell session.
 *
 * Idempotency:
 *   Without --force the SELECT filter is `NOT (metadata ? 'tickers')`, so
 *   re-running after a full backfill updates zero rows. The empty-result
 *   case (`tickers = []`) still writes the key so the row is skipped on
 *   subsequent runs.
 *
 * Cursor: keyset pagination via `c.id > lastId` ordered by `c.id`. Works
 * correctly for both dry-run (cursor advances without UPDATE) and wet-run
 * (updated rows drop out of the `NOT (metadata ? 'tickers')` candidate set
 * automatically, so a plain top-N SELECT would also terminate — the cursor
 * is used uniformly for consistency).
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, type Type } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '@finsentinel/db';
import { extractIssuerAndTickers } from '../../document/metadata-extractors/issuer-ticker-extractor';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BackfillCliArgs {
  dryRun: boolean;
  batchSize: number;
  progressEveryBatches: number;
  force: boolean;
}

export interface ChunkRowForBackfill {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  originalFileName: string | null;
  docTitle: string | null;
}

export type ChunkRowFetcher = (limit: number) => Promise<ChunkRowForBackfill[]>;

export type ChunkRowUpdater = (id: string, newFields: Record<string, unknown>) => Promise<void>;

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
  chunkTickersBackfillConfirm: string | undefined;
  fixtureSeedConfirm: string | undefined;
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_PROGRESS_EVERY = 1;

const KNOWN_FLAGS = new Set(['--dry-run', '--batch-size', '--progress-every', '--force']);

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
    progressEveryBatches: DEFAULT_PROGRESS_EVERY,
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--force') {
      args.force = true;
    } else if (a === '--batch-size' && argv[i + 1] !== undefined) {
      args.batchSize = parsePositiveInt('--batch-size', argv[++i]!);
    } else if (a === '--progress-every' && argv[i + 1] !== undefined) {
      args.progressEveryBatches = parsePositiveInt('--progress-every', argv[++i]!);
    } else if (a.startsWith('--')) {
      throw new Error(`unrecognized flag: ${a}. Known flags: ${[...KNOWN_FLAGS].join(', ')}`);
    } else {
      throw new Error(`unrecognized positional argument: ${a}`);
    }
  }

  return args;
}

// ── Production guard ──────────────────────────────────────────────────────────

export function isObviouslyEphemeralDb(url: string): boolean {
  // Same conservative allow-list as seed-fixture.cli.ts and
  // rag-backfill-representation-sparse.cli.ts.
  if (/@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url)) return true;
  if (/\/(finsentinel_test|finsentinel_ci|finsentinel_ephemeral)(\?|$)/.test(url)) return true;
  return false;
}

export function guardProductionAccidents(env: GuardEnv): void {
  if (env.nodeEnv === 'test') return;
  if (isObviouslyEphemeralDb(env.databaseUrl)) return;
  if (env.chunkTickersBackfillConfirm === '1') return;
  // Parity with seed-fixture: operators often already have this one exported.
  if (env.fixtureSeedConfirm === '1') return;

  throw new Error(
    `Refusing to backfill chunk issuer/tickers into a non-ephemeral database.\n` +
      `DATABASE_URL does not look local/test (got host pattern not in allow-list) ` +
      `and NODE_ENV is not 'test'.\n` +
      `If you really mean to backfill this DB, set CHUNK_TICKERS_BACKFILL_CONFIRM=1.`,
  );
}

// ── Core loop (pure — DI'd fetcher + updater for testability) ─────────────────

export interface BackfillRunOptions {
  fetchBatch: ChunkRowFetcher;
  updateRow: ChunkRowUpdater;
  batchSize: number;
  dryRun: boolean;
  progressEveryBatches: number;
  logger: BackfillProgressLogger;
}

// Limit chunkText to first 2000 characters — enough to land an issuer mention
// without blowing cost on giant chunks. The value is a character count, not a
// byte count. Ticker symbols are always ASCII so the slice is never mid-character.
const CHUNK_TEXT_LIMIT = 2000;

export async function backfillChunkIssuerTickers(
  opts: BackfillRunOptions,
): Promise<BackfillSummary> {
  const { fetchBatch, updateRow, batchSize, dryRun, progressEveryBatches, logger } = opts;
  let candidatesScanned = 0;
  let rowsUpdated = 0;
  let batchesProcessed = 0;

  // Stream batches until the fetcher returns fewer rows than requested.
  // Dry-run: the fetcher MUST advance its keyset cursor (no UPDATE removes
  // rows from the candidate set) — the DB-wired fetcher uses `id > lastId`.
  // Wet-run: updated rows drop out of `NOT (metadata ? 'tickers')`, so a
  // plain top-N SELECT also terminates; the cursor is used uniformly.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await fetchBatch(batchSize);
    if (batch.length === 0) break;
    candidatesScanned += batch.length;
    batchesProcessed++;

    if (!dryRun) {
      for (const row of batch) {
        const result = extractIssuerAndTickers({
          originalFileName: row.originalFileName,
          docTitle: row.docTitle,
          chunkText: row.content.slice(0, CHUNK_TEXT_LIMIT),
        });

        // Always write tickers (even []) so the idempotency filter skips
        // this row on subsequent runs. Only write issuerName when found.
        const newFields: Record<string, unknown> = {
          tickers: result.tickers,
          ...(result.issuerName ? { issuerName: result.issuerName } : {}),
        };

        await updateRow(row.id, newFields);
        rowsUpdated++;
      }
    }

    if (batchesProcessed % progressEveryBatches === 0) {
      logger.info(
        `[backfill-chunk-tickers] batch ${batchesProcessed} — ${rowsUpdated} updated, ` +
          `${candidatesScanned} scanned` +
          (dryRun ? ' (dry-run)' : ''),
      );
    }

    if (batch.length < batchSize) break;
  }

  return { candidatesScanned, rowsUpdated, batchesProcessed };
}

// ── DB wiring (runtime only — not used by unit tests) ─────────────────────────

/**
 * Build a fetcher that SELECTs the next `limit` candidate chunk rows.
 * Without --force, filters to `NOT (c.metadata ? 'tickers')`.
 * Always orders by `c.id` and advances a keyset cursor so dry-run does not
 * loop on the same rows.
 */
function buildDbFetcher(db: DrizzleDB, force: boolean): ChunkRowFetcher {
  let lastId: string | null = null;

  return async (limit: number) => {
    const idempotencyFilter = force ? sql`` : sql`AND NOT (c.metadata ? 'tickers')`;
    // The cursor (c.id > lastId) is always applied, not just under --dry-run.
    // Under normal (non-force) wet-run, the `NOT (metadata ? 'tickers')` filter
    // already drains the candidate set, so the cursor is belt-and-suspenders.
    // Under --force, the idempotency filter is absent; the cursor becomes the
    // ONLY mechanism preventing infinite re-fetch of the same rows. Do not
    // strip this cursor when refactoring.
    const cursorFilter = lastId ? sql`AND c.id > ${lastId}` : sql``;

    const rows = await db.execute<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      original_file_name: string | null;
      doc_title: string | null;
    }>(sql`
      SELECT
        c.id                  AS id,
        c.content             AS content,
        c.metadata            AS metadata,
        d.original_file_name  AS original_file_name,
        d.meta_title          AS doc_title
      FROM document_chunks c
      LEFT JOIN documents d ON d.id::text = c.source_id
      WHERE TRUE
      ${idempotencyFilter}
      ${cursorFilter}
      ORDER BY c.id
      LIMIT ${limit}
    `);

    const arr = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    const mapped = (
      arr as Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
        original_file_name: string | null;
        doc_title: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      content: r.content,
      metadata: r.metadata ?? {},
      originalFileName: r.original_file_name,
      docTitle: r.doc_title,
    }));

    if (mapped.length > 0) {
      lastId = mapped[mapped.length - 1]!.id;
    }

    return mapped;
  };
}

function buildDbUpdater(db: DrizzleDB): ChunkRowUpdater {
  return async (id, newFields) => {
    await db.execute(sql`
      UPDATE document_chunks
      SET metadata = metadata || ${JSON.stringify(newFields)}::jsonb
      WHERE id = ${id}
    `);
  };
}

// ── NestJS bootstrap module (only for runtime; tests bypass this) ─────────────

async function createBackfillChunkIssuerTickersCliModule(): Promise<Type<unknown>> {
  const { AppConfigModule, DatabaseModule } = await import('../../config');

  @Module({
    imports: [AppConfigModule, DatabaseModule],
    providers: [],
  })
  class BackfillChunkIssuerTickersCliModule {}

  return BackfillChunkIssuerTickersCliModule;
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

async function main(): Promise<void> {
  const cliArgs = parseBackfillArgs(process.argv.slice(2));

  console.log(
    `[backfill-chunk-tickers] batch_size=${cliArgs.batchSize} ` +
      `force=${cliArgs.force} ` +
      `dry_run=${cliArgs.dryRun} ` +
      `progress_every=${cliArgs.progressEveryBatches}`,
  );

  requireDatabaseUrl();

  if (!cliArgs.dryRun) {
    guardProductionAccidents({
      databaseUrl: process.env['DATABASE_URL'] ?? '',
      nodeEnv: process.env['NODE_ENV'],
      chunkTickersBackfillConfirm: process.env['CHUNK_TICKERS_BACKFILL_CONFIRM'],
      fixtureSeedConfirm: process.env['FIXTURE_SEED_CONFIRM'],
    });
  }

  const BackfillChunkIssuerTickersCliModule = await createBackfillChunkIssuerTickersCliModule();
  const app = await NestFactory.createApplicationContext(BackfillChunkIssuerTickersCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const db = app.get<DrizzleDB>('DRIZZLE_DB');
    const summary = await backfillChunkIssuerTickers({
      fetchBatch: buildDbFetcher(db, cliArgs.force),
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
    console.log('rag:backfill:chunk-issuer-tickers');
    console.log('----------------------------------');
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
    console.error('[backfill-chunk-tickers] FAILED:', err);
    // eslint-disable-next-line no-magic-numbers
    process.exit(2);
  });
}
