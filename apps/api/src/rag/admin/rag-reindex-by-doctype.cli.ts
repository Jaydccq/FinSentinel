/**
 * rag-reindex-by-doctype.cli.ts
 *
 * Re-chunks existing VECTORIZED documents through the doc-type-aware chunkers
 * introduced in R6.2–R6.5. After each batch, blocks on representation-enrichment
 * queue drain before proceeding, so the eval gate does not see a false regression
 * caused by missing representations.
 *
 * Usage (from apps/api/):
 *   pnpm rag:reindex:by-doctype [options]
 *
 * Options:
 *   --dry-run                Scan documents without re-chunking. Prints summary only.
 *   --batch <N>              Batch size (default 25). Must be a positive integer.
 *   --force                  Re-chunk even if documents.meta->>'chunker_version'
 *                            already matches the current CHUNKER_VERSION.
 *   --max-wait-seconds <N>   Cap on drain wait per batch (default 1800).
 *
 * Idempotency:
 *   Without --force, documents whose meta->>'chunker_version' already equals
 *   CHUNKER_VERSION are excluded by the SQL query AND by an in-code guard in the
 *   core loop (belt-and-suspenders).
 *
 * Safety:
 *   Refuses to run against a non-ephemeral DB unless REINDEX_BY_DOCTYPE_CONFIRM=1
 *   (or FIXTURE_SEED_CONFIRM=1 for parity with the seed-fixture allow-list).
 *   Dry-run bypasses the guard.
 *
 * PDF/DOC/DOCX skip:
 *   Documents with binary MIME types that require the sidecar parser are skipped
 *   with a warning log per document.
 *   PDF/DOC/DOCX reindex requires ParserSidecarClient — tracked as [RAG-TD-R6-01]
 *   in tech-debt-tracker.md.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '@finsentinel/db';
import { AppConfigModule, DatabaseModule } from '../../config';
import {
  REPRESENTATION_ENRICH_QUEUE,
  REPRESENTATION_ENRICH_QUEUE_TOKEN,
} from '../../queue/queue.constants';
import { DocumentParseService } from '../../document/document-parse.service';
import { DocumentVectorService } from '../../document/document-vector.service';
import { TextCleaningService } from '../../document/text-cleaning.service';
import { DocumentChunkingService } from '../../document/document-chunking.service';
import { MarkdownStructureService } from '../../document/markdown-structure.service';
import { RagEmbeddingService } from '../rag-embedding.service';
import { RagChunkStoreService } from '../rag-chunk-store.service';
import { HybridStorageService } from '../../storage/hybrid.storage';
import { RustfsStorageService } from '../../storage/rustfs.storage';
import { GoogleDriveStorageService } from '../../storage/google-drive.storage';
import { MetricsService } from '../../common/services/metrics.service';

// ── Version constant ──────────────────────────────────────────────────────────

/**
 * Unique version token stamped into documents.meta->>'chunker_version' after
 * successful re-indexing. Bump this string to force a full re-index on the next
 * CLI run.
 */
export const CHUNKER_VERSION = 'v2-doctype';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReindexCliArgs {
  dryRun: boolean;
  batch: number;
  force: boolean;
  maxWaitSeconds: number;
}

export interface DocRowForReindex {
  id: string;
  storageKey: string | null;
  docType: string;
  sector: string | null;
  originalFileName: string;
  meta: Record<string, unknown> | null;
}

export type DocRowFetcher = (limit: number) => Promise<DocRowForReindex[]>;

export type DocReindexer = (row: DocRowForReindex) => Promise<void>;

export type DrainWaiter = (maxWaitSeconds: number) => Promise<void>;

export interface ReindexProgressLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface ReindexSummary {
  docsScanned: number;
  docsReindexed: number;
  docsSkipped: number;
  batchesProcessed: number;
}

export interface ReindexRunOptions {
  fetchBatch: DocRowFetcher;
  reindexDoc: DocReindexer;
  drainWait: DrainWaiter;
  batchSize: number;
  dryRun: boolean;
  maxWaitSeconds: number;
  logger: ReindexProgressLogger;
  force?: boolean;
}

export interface GuardEnv {
  databaseUrl: string;
  nodeEnv: string | undefined;
  reindexByDoctypeConfirm: string | undefined;
  fixtureSeedConfirm: string | undefined;
}

// ── Arg parsing ────────────────────────────────────────────────────────────────

const DEFAULT_BATCH = 25;
const DEFAULT_MAX_WAIT_SECONDS = 1800;

const KNOWN_FLAGS = new Set([
  '--dry-run',
  '--batch',
  '--force',
  '--max-wait-seconds',
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

export function parseReindexArgs(argv: string[]): ReindexCliArgs {
  const args: ReindexCliArgs = {
    dryRun: false,
    batch: DEFAULT_BATCH,
    force: false,
    maxWaitSeconds: DEFAULT_MAX_WAIT_SECONDS,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--force') {
      args.force = true;
    } else if (a === '--batch' && argv[i + 1] !== undefined) {
      args.batch = parsePositiveInt('--batch', argv[++i]!);
    } else if (a === '--max-wait-seconds' && argv[i + 1] !== undefined) {
      args.maxWaitSeconds = parsePositiveInt('--max-wait-seconds', argv[++i]!);
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

// ── Production guard ───────────────────────────────────────────────────────────

export function isObviouslyEphemeralDb(url: string): boolean {
  // Same conservative allow-list as seed-fixture.cli.ts and the sparse backfill CLI.
  if (/@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url)) return true;
  if (/\/(finsentinel_test|finsentinel_ci|finsentinel_ephemeral)(\?|$)/.test(url)) return true;
  return false;
}

export function guardProductionAccidents(env: GuardEnv): void {
  if (env.nodeEnv === 'test') return;
  if (isObviouslyEphemeralDb(env.databaseUrl)) return;
  if (env.reindexByDoctypeConfirm === '1') return;
  // Parity with seed-fixture: operators often already have this one exported.
  if (env.fixtureSeedConfirm === '1') return;

  throw new Error(
    `Refusing to reindex into a non-ephemeral database.\n` +
      `DATABASE_URL does not look local/test (got host pattern not in allow-list) ` +
      `and NODE_ENV is not 'test'.\n` +
      `If you really mean to reindex this DB, set REINDEX_BY_DOCTYPE_CONFIRM=1.`,
  );
}

// ── Core loop (pure — DI'd fetcher + reindexer + drainWait for testability) ───

export async function reindexByDocType(
  opts: ReindexRunOptions,
): Promise<ReindexSummary> {
  const {
    fetchBatch,
    reindexDoc,
    drainWait,
    batchSize,
    dryRun,
    maxWaitSeconds,
    logger,
    force = false,
  } = opts;

  let docsScanned = 0;
  let docsReindexed = 0;
  let docsSkipped = 0;
  let batchesProcessed = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await fetchBatch(batchSize);
    if (batch.length === 0) break;

    docsScanned += batch.length;
    batchesProcessed++;

    if (!dryRun) {
      let batchReindexed = 0;

      for (const row of batch) {
        // Belt-and-suspenders idempotency guard: the SQL fetcher already filters
        // these out when !force, but if somehow a row slips through, skip it here.
        if (
          !force &&
          typeof row.meta === 'object' &&
          row.meta !== null &&
          (row.meta as Record<string, unknown>)['chunker_version'] === CHUNKER_VERSION
        ) {
          docsSkipped++;
          continue;
        }

        await reindexDoc(row);
        docsReindexed++;
        batchReindexed++;
      }

      // Only drain if at least one doc was actually reindexed this batch.
      if (batchReindexed > 0) {
        await drainWait(maxWaitSeconds);
      }
    }

    logger.info(
      `[reindex-by-doctype] batch ${batchesProcessed} — ${docsReindexed} reindexed, ` +
        `${docsSkipped} skipped, ${docsScanned} scanned` +
        (dryRun ? ' (dry-run)' : ''),
    );

    if (batch.length < batchSize) break;
  }

  return { docsScanned, docsReindexed, docsSkipped, batchesProcessed };
}

// ── MIME type helpers ──────────────────────────────────────────────────────────

/** MIME types that require the parser sidecar and are skipped in today's scope. */
const SIDECAR_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Guess the MIME type from a storage key / original file name.
 * Returns 'text/plain' as fallback for unknown extensions (the parser will handle it).
 */
function guessMimeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  return 'text/plain';
}

// ── DB wiring (runtime only — not used by unit tests) ─────────────────────────

function buildDbFetcher(
  db: DrizzleDB,
  force: boolean,
): DocRowFetcher {
  let lastId: string | null = null;

  return async (limit: number) => {
    // When --force is false, exclude documents already stamped with CHUNKER_VERSION.
    const idempotencyFilter = force
      ? sql``
      : sql`AND (d.meta->>'chunker_version' IS DISTINCT FROM ${CHUNKER_VERSION})`;

    // Keyset cursor prevents infinite re-fetch under --force (no rows drop out of
    // candidate set on re-select since the WHERE filter is absent).
    const cursorFilter = lastId ? sql`AND d.id > ${lastId}` : sql``;

    const rows = await db.execute<{
      id: string;
      storage_key: string | null;
      doc_type: string;
      sector: string | null;
      original_file_name: string;
      meta: Record<string, unknown> | null;
    }>(sql`
      SELECT
        d.id                  AS id,
        d.storage_key         AS storage_key,
        d.doc_type            AS doc_type,
        d.sector              AS sector,
        d.original_file_name  AS original_file_name,
        d.meta                AS meta
      FROM documents d
      WHERE d.status = 'VECTORIZED'
        AND d.storage_key IS NOT NULL
      ${idempotencyFilter}
      ${cursorFilter}
      ORDER BY d.id
      LIMIT ${limit}
    `);

    const arr = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
    const mapped = (arr as Array<{
      id: string;
      storage_key: string | null;
      doc_type: string;
      sector: string | null;
      original_file_name: string;
      meta: Record<string, unknown> | null;
    }>).map((r) => ({
      id: r.id,
      storageKey: r.storage_key,
      docType: r.doc_type,
      sector: r.sector,
      originalFileName: r.original_file_name,
      meta: r.meta ?? null,
    }));

    if (mapped.length > 0) {
      lastId = mapped[mapped.length - 1]!.id;
    }

    return mapped;
  };
}

// ── Drain waiter ───────────────────────────────────────────────────────────────

function buildDrainWaiter(queue: Queue, logger: ReindexProgressLogger): DrainWaiter {
  return async (maxWaitSeconds: number): Promise<void> => {
    const deadline = Date.now() + maxWaitSeconds * 1000;
    const stabilityWindowMs = 30_000;
    const pollIntervalMs = 2_000;
    let stableSince: number | null = null;

    while (Date.now() < deadline) {
      const [waiting, active] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
      ]);

      if (waiting === 0 && active === 0) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= stabilityWindowMs) return;
      } else {
        stableSince = null;
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    logger.warn(
      `[reindex-by-doctype] drain wait timed out after ${maxWaitSeconds}s; ` +
        `representation enrichment may still be catching up`,
    );
  };
}

// ── NestJS bootstrap module ────────────────────────────────────────────────────

// Minimal module that wires only what the reindex CLI needs at runtime.
// Heavy modules (QueueModule, DocumentModule) are intentionally avoided to
// prevent pulling in BullMQ consumers/workers, auth guards, etc.
@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [
    {
      provide: 'BULLMQ_CONNECTION',
      useFactory: (configService: ConfigService): ConnectionOptions => {
        const redisUrl = configService.get<string>('REDIS_URL')!;
        const parsed = new URL(redisUrl);
        return {
          host: parsed.hostname,
          port: Number(parsed.port) || 6379,
          password: parsed.password || undefined,
          db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
        };
      },
      inject: [ConfigService],
    },
    {
      provide: REPRESENTATION_ENRICH_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) =>
        new Queue(REPRESENTATION_ENRICH_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },
    // Storage chain
    RustfsStorageService,
    GoogleDriveStorageService,
    {
      provide: 'HOT_STORAGE',
      useExisting: RustfsStorageService,
    },
    {
      provide: 'COLD_STORAGE',
      useExisting: GoogleDriveStorageService,
    },
    HybridStorageService,
    // Document pipeline services
    TextCleaningService,
    DocumentParseService,
    DocumentChunkingService,
    MarkdownStructureService,
    // MetricsService is needed by DocumentVectorService
    MetricsService,
    RagEmbeddingService,
    RagChunkStoreService,
    DocumentVectorService,
  ],
})
class ReindexByDoctypeCliModule {}

// ── Main entrypoint ────────────────────────────────────────────────────────────

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
  const cliArgs = parseReindexArgs(process.argv.slice(2));

  console.log(
    `[reindex-by-doctype] batch=${cliArgs.batch} ` +
      `force=${cliArgs.force} ` +
      `dry_run=${cliArgs.dryRun} ` +
      `max_wait_seconds=${cliArgs.maxWaitSeconds}`,
  );

  requireDatabaseUrl();

  if (!cliArgs.dryRun) {
    guardProductionAccidents({
      databaseUrl: process.env['DATABASE_URL'] ?? '',
      nodeEnv: process.env['NODE_ENV'],
      reindexByDoctypeConfirm: process.env['REINDEX_BY_DOCTYPE_CONFIRM'],
      fixtureSeedConfirm: process.env['FIXTURE_SEED_CONFIRM'],
    });
  }

  const app = await NestFactory.createApplicationContext(ReindexByDoctypeCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const db = app.get<DrizzleDB>('DRIZZLE_DB');
    const queue = app.get<Queue>(REPRESENTATION_ENRICH_QUEUE_TOKEN);
    const storage = app.get(HybridStorageService);
    const parser = app.get(DocumentParseService);
    const vectorService = app.get(DocumentVectorService);

    const logger: ReindexProgressLogger = {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
    };

    // Build a reindexer that downloads → parses → vectorizes → stamps chunker_version.
    const reindexer: DocReindexer = async (row) => {
      const key = row.storageKey!;
      const guessedMime = guessMimeFromKey(row.originalFileName || key);

      // PDF/DOC/DOCX reindex requires ParserSidecarClient — tracked as [RAG-TD-R6-01]
      // in tech-debt-tracker.md.
      if (SIDECAR_MIME_TYPES.has(guessedMime)) {
        logger.warn(
          `[reindex-by-doctype] SKIP doc ${row.id} (${row.originalFileName}) — ` +
            `${guessedMime} requires sidecar parser [RAG-TD-R6-01]`,
        );
        return;
      }

      const content = await storage.download(key);

      let cleanText: string;
      try {
        cleanText = parser.parseToCleanText(content, guessedMime);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // USE_ASYNC_PARSER_PATH is thrown for binary MIME types that the sync
        // parser cannot handle (should be caught by SIDECAR_MIME_TYPES above,
        // but guard defensively).
        if (msg.includes('USE_ASYNC_PARSER_PATH')) {
          logger.warn(
            `[reindex-by-doctype] SKIP doc ${row.id} — parse threw USE_ASYNC_PARSER_PATH`,
          );
          return;
        }
        throw err;
      }

      await vectorService.vectorize(row.id, cleanText, {
        doc_type: row.docType,
        sector: row.sector ?? 'UNKNOWN',
        source: key,
        __originalFileName: row.originalFileName,
      });

      // Stamp chunker_version in documents.meta after successful vectorization.
      await db.execute(sql`
        UPDATE documents
        SET meta = jsonb_set(
              COALESCE(meta, '{}'::jsonb),
              '{chunker_version}',
              to_jsonb(${CHUNKER_VERSION}::text)
            )
        WHERE id = ${row.id}
      `);
    };

    const summary = await reindexByDocType({
      fetchBatch: buildDbFetcher(db, cliArgs.force),
      reindexDoc: reindexer,
      drainWait: buildDrainWaiter(queue, logger),
      batchSize: cliArgs.batch,
      dryRun: cliArgs.dryRun,
      maxWaitSeconds: cliArgs.maxWaitSeconds,
      logger,
      force: cliArgs.force,
    });

    console.log('');
    console.log('rag:reindex:by-doctype');
    console.log('----------------------');
    console.log(`Docs scanned    : ${summary.docsScanned}`);
    console.log(`Docs reindexed  : ${summary.docsReindexed}`);
    console.log(`Docs skipped    : ${summary.docsSkipped}`);
    console.log(`Batches         : ${summary.batchesProcessed}`);
    if (cliArgs.dryRun) {
      console.log('[dry-run] No re-chunking performed. Drop --dry-run to write.');
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
    console.error('[reindex-by-doctype] FAILED:', err);
    // eslint-disable-next-line no-magic-numbers
    process.exit(2);
  });
}
