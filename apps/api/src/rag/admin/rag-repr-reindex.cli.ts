/**
 * rag-repr-reindex.cli.ts
 *
 * NestJS application-context CLI that enqueues chunks whose highest-version
 * representation row is at or below the specified --from-version.
 *
 * Usage (from apps/api/):
 *   pnpm rag:repr:reindex --from-version rep-v1.0 [options]
 *
 * Options:
 *   --from-version <v>           Required. Re-enqueue chunks at this version or below.
 *   --dry-run                    Print plan + cost estimate; no queue writes.
 *   --limit <N>                  Cap total chunks processed this invocation.
 *   --source-type <document|news> Filter by source type.
 *   --source-id <uuid>           Restrict to a single source document/news item.
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
class ReindexCliModule {}

// ── CLI argument parsing ───────────────────────────────────────────────────────

interface ReindexArgs {
  fromVersion: string | undefined;
  dryRun: boolean;
  limit: number | undefined;
  sourceType: string | undefined;
  sourceId: string | undefined;
}

const KNOWN_FLAGS = new Set([
  '--dry-run',
  '--from-version',
  '--limit',
  '--source-type',
  '--source-id',
]);

/** rep-vX.Y where X and Y are non-negative integers (single or multi-digit). */
const FROM_VERSION_RE = /^rep-v\d+\.\d+$/;

function parseArgs(argv: string[]): ReindexArgs {
  const args: ReindexArgs = {
    fromVersion: undefined,
    dryRun: false,
    limit: undefined,
    sourceType: undefined,
    sourceId: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--from-version' && argv[i + 1]) {
      args.fromVersion = argv[++i];
    } else if (arg === '--limit' && argv[i + 1]) {
      args.limit = parseInt(argv[++i]!, 10);
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

  // --from-version is required
  if (!cliArgs.fromVersion) {
    console.error(
      'Error: --from-version is required.\n' +
      'Example: pnpm rag:repr:reindex --from-version rep-v1.0\n' +
      'Chunks at or below this version will be re-enqueued.',
    );
    process.exit(1);
  }

  // --from-version must match the rep-vX.Y convention.
  if (!FROM_VERSION_RE.test(cliArgs.fromVersion)) {
    console.error(
      `Error: --from-version "${cliArgs.fromVersion}" is not a valid version string.\n` +
      'Expected format: rep-vX.Y (e.g. rep-v1.0, rep-v2.3).',
    );
    process.exit(1);
  }

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

  const app = await NestFactory.createApplicationContext(ReindexCliModule, {
    logger: ['error', 'warn'],
  });

  const service = app.get(RepresentationAdminService);

  try {
    const chunks = await service.listStaleVersionChunks(
      cliArgs.fromVersion,
      cliArgs.limit,
    );

    // Apply source-type / source-id filters (post-query; listStaleVersionChunks
    // does not accept filters to keep the method signature simple)
    let filtered = chunks;
    let filteredOut = 0;
    if (cliArgs.sourceType) {
      const before = filtered.length;
      filtered = filtered.filter((c) => c.sourceType === cliArgs.sourceType);
      filteredOut += before - filtered.length;
    }
    if (cliArgs.sourceId) {
      const before = filtered.length;
      filtered = filtered.filter((c) => c.sourceId === cliArgs.sourceId);
      filteredOut += before - filtered.length;
    }

    const totalCount = filtered.length;
    const costEstimate = service.estimateCost(totalCount);

    // Per-source breakdown
    const bySource = new Map<string, number>();
    for (const chunk of filtered) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }

    console.log('');
    console.log('rag:repr:reindex');
    console.log('----------------');
    console.log(`Reindex from version  : ${cliArgs.fromVersion}`);
    console.log(`Chunks to re-enqueue  : ${totalCount}`);
    console.log(`Chunks filtered out   : ${filteredOut}`);
    console.log(`LLM calls             : ${costEstimate.llmCalls}`);
    console.log(`Embedding calls       : ${costEstimate.embeddingCalls}`);
    console.log(`Estimated cost        : $${costEstimate.estimatedUsd.toFixed(4)} USD (rough estimate; see service header)`);
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

    const enqueued = await service.enqueueForEnrichment(filtered.map((c) => c.id));
    const skipped = totalCount - enqueued;

    console.log('');
    console.log('Summary');
    console.log('-------');
    console.log(`Chunks enqueued  : ${enqueued}`);
    console.log(`Chunks skipped   : ${skipped}`);
    console.log(`Chunks filtered  : ${filteredOut}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('rag:repr:reindex CLI failed:', err);
  process.exit(1);
});
