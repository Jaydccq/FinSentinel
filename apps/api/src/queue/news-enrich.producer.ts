import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NEWS_ENRICH_QUEUE_TOKEN } from './queue.constants';

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
  ) {}

  /**
   * Add an enrichment job for the given news item.
   *
   * @param newsItemId - UUID of the news item to enrich
   */
  async send(newsItemId: string): Promise<void> {
    await this.queue.add('news-enrich', { newsItemId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    this.logger.log(`Enqueued enrichment job for news item ${newsItemId}`);
  }
}
