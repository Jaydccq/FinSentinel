/**
 * rag-backfill-representations.cli.ts
 *
 * NestJS application-context CLI that walks existing document_chunks and
 * enqueues them for representation enrichment.
 *
 * Usage (from apps/api/):
 *   pnpm rag:backfill:representations [options]
 *
 * Options:
 *   --dry-run                    Print plan + cost estimate; no queue writes.
 *   --limit <N>                  Cap total chunks processed this invocation.
 *   --batch-size <N>             DB read batch size (default: RAG_REPRESENTATION_BATCH_SIZE).
 *   --source-type <document|news> Filter by source type.
 *   --source-id <uuid>           Restrict to a single source document/news item.
 *   --only-pending               Skip chunks whose enrichment_status is not 'pending'.
 *
 * Refuses to run (exits 1) if RAG_ENRICHMENT_ENABLED=false and --dry-run is
 * not set.
 *
 * OpenRouter API key is NOT required; the CLI only reads DB and writes to BullMQ.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { AppConfigModule, DatabaseModule } from '../../config';
import { RepresentationAdminService } from './representation-admin.service';
import { RepresentationEnrichProducer } from '../../queue/representation-enrich.producer';
import {
  REPRESENTATION_ENRICH_QUEUE,
  REPRESENTATION_ENRICH_QUEUE_TOKEN,
} from '../../queue/queue.constants';

// ── Minimal bootstrap module ──────────────────────────────────────────────────

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
    RepresentationEnrichProducer,
    RepresentationAdminService,
  ],
})
class BackfillCliModule {}

// ── CLI argument parsing ───────────────────────────────────────────────────────

interface BackfillArgs {
  dryRun: boolean;
  limit: number | undefined;
  batchSize: number | undefined;
  sourceType: string | undefined;
  sourceId: string | undefined;
  onlyPending: boolean;
}

const KNOWN_FLAGS = new Set([
  '--dry-run',
  '--only-pending',
  '--limit',
  '--batch-size',
  '--source-type',
  '--source-id',
]);

function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = {
    dryRun: false,
    limit: undefined,
    batchSize: undefined,
    sourceType: undefined,
    sourceId: undefined,
    onlyPending: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--only-pending') {
      args.onlyPending = true;
    } else if (arg === '--limit' && argv[i + 1]) {
      args.limit = parseInt(argv[++i]!, 10);
    } else if (arg === '--batch-size' && argv[i + 1]) {
      args.batchSize = parseInt(argv[++i]!, 10);
    } else if (arg === '--source-type' && argv[i + 1]) {
      args.sourceType = argv[++i];
    } else if (arg === '--source-id' && argv[i + 1]) {
      args.sourceId = argv[++i];
    } else if (arg.startsWith('--')) {
      console.error(
        `Error: unrecognized flag: ${arg}\n` +
        `Known flags: ${[...KNOWN_FLAGS].join(', ')}`,
      );
      process.exit(1);
    }
  }

  return args;
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env['DATABASE_URL']) {
    console.error(
      'Error: DATABASE_URL environment variable is not set.\n' +
      'Set it to your local Postgres connection string, e.g.:\n' +
      '  DATABASE_URL=postgresql://user:pass@localhost:5432/finsentinel',
    );
    process.exit(1);
  }

  const cliArgs = parseArgs(process.argv.slice(2));

  // Safety: refuse to run without --dry-run when enrichment is globally disabled.
  const enrichmentEnabled = process.env['RAG_ENRICHMENT_ENABLED'] !== 'false';
  if (!enrichmentEnabled && !cliArgs.dryRun) {
    console.error(
      'Error: RAG_ENRICHMENT_ENABLED=false — enrichment is globally disabled.\n' +
      'Pass --dry-run to preview the plan without enqueueing, or set\n' +
      'RAG_ENRICHMENT_ENABLED=true to enable actual enrichment.',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(BackfillCliModule, {
    logger: ['error', 'warn'],
  });

  const service = app.get(RepresentationAdminService);

  try {
    const filterOptions = {
      sourceType: cliArgs.sourceType,
      sourceId: cliArgs.sourceId,
      limit: cliArgs.limit,
    };

    // Fetch candidate chunks
    let chunks = await service.listUnenrichedChunks(filterOptions);

    // --only-pending: skip chunks that are not in 'pending' status
    if (cliArgs.onlyPending) {
      const before = chunks.length;
      chunks = chunks.filter((c) => c.enrichmentStatus === 'pending');
      const filtered = before - chunks.length;
      if (filtered > 0) {
        console.log(`[filter] --only-pending: skipped ${filtered} chunks not in pending status`);
      }
    }

    const totalCount = chunks.length;
    const costEstimate = service.estimateCost(totalCount);

    // Per-source breakdown
    const bySource = new Map<string, number>();
    for (const chunk of chunks) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }

    console.log('');
    console.log('rag:backfill:representations');
    console.log('----------------------------');
    console.log(`Chunks to enqueue  : ${totalCount}`);
    console.log(`Current version    : ${process.env['CURRENT_REPRESENTATION_VERSION'] ?? 'rep-v1.0'}`);
    console.log(`LLM calls          : ${costEstimate.llmCalls}`);
    console.log(`Embedding calls    : ${costEstimate.embeddingCalls}`);
    console.log(`Estimated cost     : $${costEstimate.estimatedUsd.toFixed(4)} USD (rough estimate; see service header)`);
    console.log('');

    if (bySource.size > 0 && bySource.size <= 20) {
      console.log('Per-source breakdown:');
      for (const [key, count] of bySource) {
        console.log(`  ${key}: ${count} chunk(s)`);
      }
      console.log('');
    } else if (bySource.size > 20) {
      console.log(`Per-source breakdown: ${bySource.size} distinct sources (too many to list)`);
      console.log('');
    }

    if (cliArgs.dryRun) {
      console.log('[dry-run] No jobs enqueued. Remove --dry-run to execute.');
      return;
    }

    // Enqueue in batches
    const batchSize = cliArgs.batchSize ?? service.getBatchSize();
    let totalEnqueued = 0;
    let totalSkipped = 0;

    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      const ids = batch.map((c) => c.id);
      const enqueued = await service.enqueueForEnrichment(ids);
      const skipped = ids.length - enqueued;
      totalEnqueued += enqueued;
      totalSkipped += skipped;
    }

    console.log('');
    console.log('Summary');
    console.log('-------');
    console.log(`Chunks enqueued  : ${totalEnqueued}`);
    console.log(`Chunks skipped   : ${totalSkipped}`);
    console.log(`Chunks filtered  : 0`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('rag:backfill:representations CLI failed:', err);
  process.exit(1);
});
