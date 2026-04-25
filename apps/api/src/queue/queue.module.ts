import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import {
  VECTORIZE_QUEUE,
  NEWS_ENRICH_QUEUE,
  GRAPH_ENRICH_QUEUE,
  VECTORIZE_QUEUE_TOKEN,
  NEWS_ENRICH_QUEUE_TOKEN,
  GRAPH_ENRICH_QUEUE_TOKEN,
  ANALYSIS_RUN_QUEUE,
  ANALYSIS_RUN_QUEUE_TOKEN,
  REPRESENTATION_ENRICH_QUEUE,
  REPRESENTATION_ENRICH_QUEUE_TOKEN,
} from './queue.constants';
import { VectorizeProducer } from './vectorize.producer';
import { VectorizeConsumer } from './vectorize.consumer';
import { NewsEnrichProducer } from './news-enrich.producer';
import { NewsEnrichConsumer } from './news-enrich.consumer';
import { GraphEnrichProducer } from './graph-enrich.producer';
import { GraphEnrichConsumer } from './graph-enrich.consumer';
import { AnalysisRunProducer } from './analysis-run.producer';
import { AnalysisRunConsumer } from './analysis-run.consumer';
import { RepresentationEnrichProducer } from './representation-enrich.producer';
import { RepresentationEnrichConsumer } from './representation-enrich.consumer';
import { DocumentModule } from '../document/document.module';
import { StorageModule } from '../storage/storage.module';
import { NewsModule } from '../news/news.module';
import { ScraperModule } from '../scraper/scraper.module';
import { CommonModule } from '../common/common.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { RagModule } from '../rag/rag.module';

/**
 * BullMQ queue infrastructure module.
 *
 * Provides:
 * - BULLMQ_CONNECTION — shared ioredis ConnectionOptions for all queues/workers
 * - VECTORIZE_QUEUE — Queue instance for document vectorization
 * - NEWS_ENRICH_QUEUE — Queue instance for news enrichment
 * - VectorizeProducer / NewsEnrichProducer — injectable services to enqueue jobs
 * - VectorizeConsumer / NewsEnrichConsumer — workers that process jobs
 *
 * Uses BullMQ queues (`vectorize`, `news-enrich`)
 * with BullMQ for reliable job processing with retries, backoff, and
 * dead-letter handling.
 */
@Module({
  imports: [
    CommonModule,
    forwardRef(() => DocumentModule),
    StorageModule,
    forwardRef(() => NewsModule),
    ScraperModule,
    forwardRef(() => AnalysisModule),
    forwardRef(() => RagModule),
  ],
  providers: [
    // ── BullMQ connection (shared by all queues and workers) ──────────
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

    // ── Vectorize queue ──────────────────────────────────────────────
    {
      provide: VECTORIZE_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) => new Queue(VECTORIZE_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },

    // ── News enrich queue ────────────────────────────────────────────
    {
      provide: NEWS_ENRICH_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) => new Queue(NEWS_ENRICH_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },

    // ── Graph enrich queue ──────────────────────────────────────────
    {
      provide: GRAPH_ENRICH_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) => new Queue(GRAPH_ENRICH_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },

    // ── Analysis run queue ──────────────────────────────────────────
    {
      provide: ANALYSIS_RUN_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) => new Queue(ANALYSIS_RUN_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },

    // ── Representation enrich queue ─────────────────────────────────
    {
      provide: REPRESENTATION_ENRICH_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) =>
        new Queue(REPRESENTATION_ENRICH_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },

    // ── Producers ────────────────────────────────────────────────────
    VectorizeProducer,
    NewsEnrichProducer,
    GraphEnrichProducer,
    AnalysisRunProducer,
    RepresentationEnrichProducer,

    // ── Consumers (workers) ──────────────────────────────────────────
    VectorizeConsumer,
    NewsEnrichConsumer,
    GraphEnrichConsumer,
    AnalysisRunConsumer,
    RepresentationEnrichConsumer,
  ],
  exports: [
    VectorizeProducer,
    NewsEnrichProducer,
    GraphEnrichProducer,
    AnalysisRunProducer,
    RepresentationEnrichProducer,
  ],
})
export class QueueModule {}
