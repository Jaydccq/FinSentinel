/**
 * rag-promote-eval.cli.ts
 *
 * NestJS application-context CLI that promotes a window of `rag_query_logs`
 * rows into the golden eval set at
 * `services/evaluation-runner/datasets/golden.json`.
 *
 * Usage (from apps/api/):
 *   pnpm rag:eval:promote -- [options]
 *
 * Options:
 *   --per-class <N>   Sample cap per query_class. Default 10.
 *   --since <ISO>     Lower bound on created_at. Default: now - 30d.
 *   --out <path>      Override golden.json path. Default the canonical
 *                     services/evaluation-runner/datasets/golden.json.
 *   --dry-run         Don't write. Print a class-balance summary and exit.
 *
 * Phase 1 deliverable: the *tooling*. Reviewer-driven promotion (actually
 * mutating the golden set) happens in a separate operational PR — see
 * docs/runbooks/2026-04-25-rag-eval-promotion-runbook.md.
 *
 * Schema mapping (verified 2026-04-25 against
 * packages/db/src/schema/rag-query-logs.ts):
 *   id              -> source_query_log_id
 *   query_preview   -> query (after PII redaction)
 *   query_class     -> query_class (snake-case)
 *   result_chunk_ids -> expected_chunk_ids
 *
 * NOTE: query_preview is NULL unless `rag.queryLog.piiEnabled = true` was set
 * at trace time. The CLI surfaces this to the operator clearly so they enable
 * the flag in the staging window before promoting.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, type Type } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '@finsentinel/db';
import {
  stratifiedSample,
  buildPromotedRow,
  appendPromotedRows,
  summarizeByClass,
  type QueryLogRow,
  type GoldenSetFile,
  type PromotedRow,
} from './rag-promote-eval.service';

// ── Paths ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../../..');
const DEFAULT_GOLDEN_PATH = resolve(
  REPO_ROOT,
  'services/evaluation-runner/datasets/golden.json',
);
const DEFAULT_META_PATH = resolve(
  REPO_ROOT,
  'services/evaluation-runner/datasets/golden.meta.json',
);

// ── Arg parsing ───────────────────────────────────────────────────────────────

export interface PromoteCliArgs {
  perClass: number;
  since: string;
  outputPath: string;
  metaPath: string;
  dryRun: boolean;
}

const KNOWN_FLAGS = new Set(['--per-class', '--since', '--out', '--meta', '--dry-run']);

function defaultSinceIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString();
}

export function parsePromoteArgs(argv: string[], now: Date = new Date()): PromoteCliArgs {
  const args: PromoteCliArgs = {
    perClass: 10,
    since: defaultSinceIso(now),
    outputPath: DEFAULT_GOLDEN_PATH,
    metaPath: DEFAULT_META_PATH,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      // pnpm passes through `--` as a separator before user args; ignore it.
      continue;
    }
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--per-class' && argv[i + 1] !== undefined) {
      const n = Number(argv[++i]!);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new Error(`--per-class must be a positive integer, got ${argv[i]}`);
      }
      args.perClass = n;
    } else if (a === '--since' && argv[i + 1] !== undefined) {
      const raw = argv[++i]!;
      if (Number.isNaN(Date.parse(raw))) {
        throw new Error(`--since must be an ISO timestamp, got ${JSON.stringify(raw)}`);
      }
      args.since = raw;
    } else if (a === '--out' && argv[i + 1] !== undefined) {
      args.outputPath = argv[++i]!;
    } else if (a === '--meta' && argv[i + 1] !== undefined) {
      args.metaPath = argv[++i]!;
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

// ── Pure pipeline (DI'd fetcher, IO, clock) ──────────────────────────────────

export interface PromotePipelineDeps {
  /** Returns rows ordered by created_at DESC, since `sinceIso`. */
  fetchLogs: (sinceIso: string) => Promise<QueryLogRow[]>;
  readGolden: (path: string) => Promise<GoldenSetFile>;
  readMeta: (path: string) => Promise<Record<string, unknown> | null>;
  writeGolden: (path: string, value: GoldenSetFile) => Promise<void>;
  writeMeta: (path: string, value: Record<string, unknown>) => Promise<void>;
  now: () => Date;
  logger: { info: (s: string) => void; warn: (s: string) => void };
}

export interface PromotePipelineResult {
  classes: Record<string, number>;
  total: number;
  added: number;
  skippedDuplicates: number;
  withoutPreview: number;
}

export async function runPromotePipeline(
  args: PromoteCliArgs,
  deps: PromotePipelineDeps,
): Promise<PromotePipelineResult> {
  const logs = await deps.fetchLogs(args.since);
  const withPreview = logs.filter(
    (l) => typeof l.query_preview === 'string' && l.query_preview.trim().length > 0,
  );
  const withoutPreview = logs.length - withPreview.length;

  if (logs.length === 0) {
    deps.logger.warn(
      `[promote-eval] no rag_query_logs rows since ${args.since}. ` +
        `Either no traffic, or rag.queryLog retention dropped the partitions.`,
    );
  } else if (withPreview.length === 0) {
    deps.logger.warn(
      `[promote-eval] all ${logs.length} rows have NULL query_preview. ` +
        `Set rag.queryLog.piiEnabled=true in the staging window before promoting, ` +
        `then re-run.`,
    );
  }

  const sampled = stratifiedSample(withPreview, { perClass: args.perClass });
  const summary = summarizeByClass(sampled);
  const promotedAt = deps.now().toISOString();
  const candidates: PromotedRow[] = sampled.map((log) => buildPromotedRow(log, { promotedAt }));

  if (args.dryRun) {
    deps.logger.info(
      `[promote-eval][dry-run] sampled=${candidates.length} classes=${JSON.stringify(
        summary.classes,
      )} without_preview=${withoutPreview}`,
    );
    return {
      classes: summary.classes,
      total: summary.total,
      added: 0,
      skippedDuplicates: 0,
      withoutPreview,
    };
  }

  const golden = await deps.readGolden(args.outputPath);
  const { added, skipped } = appendPromotedRows(golden, candidates);
  await deps.writeGolden(args.outputPath, golden);

  // Update meta sidecar (best-effort — tolerate a missing file).
  const meta = (await deps.readMeta(args.metaPath)) ?? {};
  const promotionLog = Array.isArray(meta['promotion_log']) ? meta['promotion_log'] : [];
  promotionLog.push({
    promoted_at: promotedAt,
    since: args.since,
    per_class: args.perClass,
    added: added.length,
    skipped_duplicates: skipped.length,
    without_preview: withoutPreview,
    classes: summary.classes,
  });
  meta['promotion_log'] = promotionLog;
  meta['last_promoted_at'] = promotedAt;
  // Bump version on each successful append. Format: <prev>.p<count> if present,
  // otherwise just stamp 'promoted-<timestamp>'.
  const prevVersion = typeof meta['version'] === 'string' ? (meta['version'] as string) : 'unversioned';
  meta['version'] = `${prevVersion}+promoted-${promotionLog.length}`;
  await deps.writeMeta(args.metaPath, meta);

  deps.logger.info(
    `[promote-eval] added=${added.length} skipped_duplicates=${skipped.length} ` +
      `without_preview=${withoutPreview} -> ${args.outputPath}`,
  );
  return {
    classes: summary.classes,
    total: summary.total,
    added: added.length,
    skippedDuplicates: skipped.length,
    withoutPreview,
  };
}

// ── DB-backed fetcher (runtime only) ──────────────────────────────────────────

function buildDbFetcher(db: DrizzleDB): PromotePipelineDeps['fetchLogs'] {
  return async (sinceIso: string): Promise<QueryLogRow[]> => {
    const rows = await db.execute<{
      id: string;
      query_preview: string | null;
      query_class: string | null;
      result_chunk_ids: string[] | null;
      created_at: string;
    }>(sql`
      SELECT
        id::text AS id,
        query_preview,
        query_class,
        result_chunk_ids::text[] AS result_chunk_ids,
        created_at
      FROM rag_query_logs
      WHERE created_at >= ${sinceIso}::timestamptz
        AND query_class IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5000
    `);
    const arr = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    return (
      arr as Array<{
        id: string;
        query_preview: string | null;
        query_class: string | null;
        result_chunk_ids: string[] | null;
        created_at: string;
      }>
    )
      .filter((r): r is typeof r & { query_class: string } => r.query_class !== null)
      .map((r) => ({
        id: r.id,
        query_preview: r.query_preview,
        query_class: r.query_class,
        result_chunk_ids: r.result_chunk_ids ?? [],
        created_at: r.created_at,
      }));
  };
}

// ── File IO bindings ──────────────────────────────────────────────────────────

async function readGoldenFile(path: string): Promise<GoldenSetFile> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as GoldenSetFile;
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`golden file at ${path} is missing an 'entries' array`);
  }
  return parsed;
}

async function readMetaFile(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

// ── NestJS bootstrap ──────────────────────────────────────────────────────────

async function createPromoteEvalCliModule(): Promise<Type<unknown>> {
  const { AppConfigModule, DatabaseModule } = await import('../../config');

  @Module({
    imports: [AppConfigModule, DatabaseModule],
    providers: [],
  })
  class PromoteEvalCliModule {}

  return PromoteEvalCliModule;
}

// ── Main entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cliArgs = parsePromoteArgs(process.argv.slice(2));

  if (!process.env['DATABASE_URL']) {
    console.error(
      'Error: DATABASE_URL environment variable is not set.\n' +
        'Set it to your local Postgres connection string, e.g.:\n' +
        '  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finsentinel',
    );
    process.exit(1);
  }

  console.log(
    `[promote-eval] per_class=${cliArgs.perClass} since=${cliArgs.since} ` +
      `out=${cliArgs.outputPath} dry_run=${cliArgs.dryRun}`,
  );

  const PromoteEvalCliModule = await createPromoteEvalCliModule();
  const app = await NestFactory.createApplicationContext(PromoteEvalCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const db = app.get<DrizzleDB>('DRIZZLE_DB');
    const result = await runPromotePipeline(cliArgs, {
      fetchLogs: buildDbFetcher(db),
      readGolden: readGoldenFile,
      readMeta: readMetaFile,
      writeGolden: (path, v) => writeJsonFile(path, v),
      writeMeta: (path, v) => writeJsonFile(path, v),
      now: () => new Date(),
      logger: {
        info: (s) => console.log(s),
        warn: (s) => console.warn(s),
      },
    });
    console.log('');
    console.log('rag:eval:promote');
    console.log('----------------');
    console.log(`Total sampled        : ${result.total}`);
    console.log(`Class balance        : ${JSON.stringify(result.classes)}`);
    console.log(`Added                : ${result.added}`);
    console.log(`Skipped (duplicates) : ${result.skippedDuplicates}`);
    console.log(`Rows without preview : ${result.withoutPreview}`);
    if (cliArgs.dryRun) {
      console.log('[dry-run] No writes were issued. Drop --dry-run to promote.');
    }
  } finally {
    await app.close();
  }
}

const isEntrypoint = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((err) => {
    console.error('[promote-eval] FAILED:', err);
    // eslint-disable-next-line no-magic-numbers
    process.exit(2);
  });
}
