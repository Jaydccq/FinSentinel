import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { newsItems, eq } from '@finsentinel/db';
import { NEWS_ENRICH_QUEUE } from './queue.constants';
import { NewsSentimentService } from '../news/news-sentiment.service';
import { FirecrawlClient } from '../scraper/firecrawl.client';
import { DocumentVectorService } from '../document/document-vector.service';

export interface NewsEnrichJobData {
  newsItemId: string;
}

/**
 * BullMQ worker that processes news enrichment jobs.
 *
 * Pipeline:
 * 1. Load NewsItem from DB
 * 2. Scrape full article content via FirecrawlClient
 * 3. Classify sentiment via NewsSentimentService
 * 4. Vectorize scraped content for RAG retrieval
 * 5. Update NewsItem with sentiment + mark as enriched
 */
@Injectable()
export class NewsEnrichConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsEnrichConsumer.name);
  private worker!: Worker<NewsEnrichJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    private readonly sentimentService: NewsSentimentService,
    private readonly firecrawl: FirecrawlClient,
    private readonly vectorService: DocumentVectorService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<NewsEnrichJobData>(
      NEWS_ENRICH_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.connection,
        concurrency: 2,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `News enrich job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`News enrich job ${job.id} completed`);
    });

    this.logger.log('NewsEnrichConsumer worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('NewsEnrichConsumer worker stopped');
    }
  }

  /**
   * Process a single news enrichment job.
   *
   * Exposed as a separate method to facilitate unit testing.
   */
  async process(job: Job<NewsEnrichJobData>): Promise<void> {
    const { newsItemId } = job.data;
    this.logger.log(`Processing enrichment for news item ${newsItemId}`);

    // 1. Load news item from DB
    const [item] = await this.db
      .select({
        id: newsItems.id,
        title: newsItems.title,
        summary: newsItems.summary,
        articleUrl: newsItems.articleUrl,
        source: newsItems.source,
        enriched: newsItems.enriched,
      })
      .from(newsItems)
      .where(eq(newsItems.id, newsItemId))
      .limit(1);

    if (!item) {
      throw new Error(`News item ${newsItemId} not found`);
    }

    if (item.enriched) {
      this.logger.debug(`News item ${newsItemId} already enriched, skipping`);
      return;
    }

    // 2. Scrape full article content (if URL available)
    let fullContent: string | null = null;
    if (item.articleUrl) {
      try {
        fullContent = await this.firecrawl.scrape(item.articleUrl);
      } catch (err) {
        this.logger.warn(
          `Failed to scrape ${item.articleUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Continue with title + summary for sentiment; skip vectorization
      }
    }

    // 3. Classify sentiment
    const sentiment = await this.sentimentService.classify(
      item.title,
      item.summary,
    );

    // 4. Vectorize scraped content for RAG (if we got full text)
    let documentId: string | undefined;
    if (fullContent) {
      try {
        const chunkCount = await this.vectorService.vectorize(
          newsItemId,
          fullContent,
          {
            doc_type: 'NEWS',
            sector: '',
            region_id: 'US',
            source: item.source,
            date: new Date().toISOString().split('T')[0]!,
          },
        );
        this.logger.log(
          `News item ${newsItemId} vectorized: ${chunkCount} chunks`,
        );
      } catch (err) {
        this.logger.warn(
          `Vectorization failed for news item ${newsItemId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Non-fatal: still mark as enriched with sentiment
      }
    }

    // 5. Update news item: set sentiment, mark enriched
    await this.db
      .update(newsItems)
      .set({
        sentiment,
        enriched: true,
        ...(documentId ? { documentId } : {}),
      })
      .where(eq(newsItems.id, newsItemId));

    this.logger.log(
      `News item ${newsItemId} enriched: sentiment=${sentiment}`,
    );
  }
}
