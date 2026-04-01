import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import {
  VECTORIZE_QUEUE,
  NEWS_ENRICH_QUEUE,
  VECTORIZE_QUEUE_TOKEN,
  NEWS_ENRICH_QUEUE_TOKEN,
} from './queue.constants';
import { VectorizeProducer } from './vectorize.producer';
import { VectorizeConsumer } from './vectorize.consumer';
import { NewsEnrichProducer } from './news-enrich.producer';
import { NewsEnrichConsumer } from './news-enrich.consumer';
import { DocumentModule } from '../document/document.module';
import { StorageModule } from '../storage/storage.module';
import { NewsModule } from '../news/news.module';
import { ScraperModule } from '../scraper/scraper.module';

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
 * Replaces the Java Redis Streams (`stream:vectorize`, `stream:news-enrich`)
 * with BullMQ for reliable job processing with retries, backoff, and
 * dead-letter handling.
 */
@Module({
  imports: [DocumentModule, StorageModule, NewsModule, ScraperModule],
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
      useFactory: (connection: ConnectionOptions) =>
        new Queue(VECTORIZE_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },

    // ── News enrich queue ────────────────────────────────────────────
    {
      provide: NEWS_ENRICH_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) =>
        new Queue(NEWS_ENRICH_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },

    // ── Producers ────────────────────────────────────────────────────
    VectorizeProducer,
    NewsEnrichProducer,

    // ── Consumers (workers) ──────────────────────────────────────────
    VectorizeConsumer,
    NewsEnrichConsumer,
  ],
  exports: [VectorizeProducer, NewsEnrichProducer],
})
export class QueueModule {}
