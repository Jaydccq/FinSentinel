import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NEWS_ENRICH_QUEUE_TOKEN } from './queue.constants';
import { MetricsService } from '../common/services/metrics.service';

/**
 * Enqueues news enrichment jobs.
 *
 * Usage: inject NewsEnrichProducer and call `send(newsItemId)` after
 * persisting a new NewsItem. The NewsEnrichConsumer will scrape full
 * content, classify sentiment, vectorize, and mark the item as enriched.
 */
@Injectable()
export class NewsEnrichProducer {
  private readonly logger = new Logger(NewsEnrichProducer.name);

  constructor(
    @Inject(NEWS_ENRICH_QUEUE_TOKEN) private readonly queue: Queue,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Add an enrichment job for the given news item.
   *
   * @param newsItemId - UUID of the news item to enrich
   */
  async send(newsItemId: string): Promise<void> {
    await this.queue.add('news-enrich', { newsItemId }, {
      jobId: `news-enrich:${newsItemId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    this.metrics.incrementCounter(
      'rag_jobs_enqueued_total',
      'Total number of RAG-related jobs enqueued',
      { job_type: 'news-enrich' },
    );
    this.metrics.setGauge(
      'rag_job_enqueue_last_timestamp_seconds',
      'Unix timestamp of the most recent RAG-related job enqueue',
      { job_type: 'news-enrich' },
      Date.now() / 1000,
    );
    this.logger.log(`Enqueued enrichment job for news item ${newsItemId}`);
  }
}
