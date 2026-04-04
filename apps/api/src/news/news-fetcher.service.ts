import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { newsItems, eq, and } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import type { RawNewsItem, NewsFetcher } from './interfaces/news-fetcher';
import { NewsEnrichProducer } from '../queue/news-enrich.producer';

/**
 * Orchestrator that polls all registered NewsFetcher implementations,
 * deduplicates against the DB, and persists new items.
 *
 * When QueueModule is loaded, newly saved items are automatically
 * enqueued for enrichment (scrape, sentiment, vectorize).
 */
@Injectable()
export class NewsFetcherService {
  private readonly logger = new Logger(NewsFetcherService.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    @Inject('NEWS_FETCHERS') private readonly fetchers: NewsFetcher[],
    @Optional() private readonly enrichProducer?: NewsEnrichProducer,
  ) {}

  /**
   * Poll all registered fetchers, dedup via DB, and save new items.
   * Returns the count of newly saved items.
   */
  async pollAll(tickers: string[] = []): Promise<number> {
    let savedCount = 0;

    for (const fetcher of this.fetchers) {
      try {
        const items = await fetcher.fetch(tickers);
        for (const item of items) {
          const savedId = await this.saveIfNew(item);
          if (savedId) {
            savedCount++;
            // Enqueue for enrichment if producer is available
            if (this.enrichProducer) {
              await this.enrichProducer.send(savedId);
            }
          }
        }
      } catch (err) {
        this.logger.error(
          `Fetcher ${fetcher.getSource()} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return savedCount;
  }

  /**
   * Check if a news item already exists by (source, sourceId).
   * If not, insert it and return the new item's ID. Otherwise return null.
   */
  private async saveIfNew(item: RawNewsItem): Promise<string | null> {
    const existing = await this.db
      .select({ id: newsItems.id })
      .from(newsItems)
      .where(
        and(
          eq(newsItems.source, item.source),
          eq(newsItems.sourceId, item.sourceId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return null;
    }

    const [inserted] = await this.db.insert(newsItems).values({
      sourceId: item.sourceId,
      source: item.source,
      title: item.title,
      summary: item.summary,
      articleUrl: item.articleUrl,
      author: item.author,
      publishedAt: new Date(item.publishedAt),
      tickers: item.tickers,
      tags: item.tags,
    }).returning({ id: newsItems.id });

    return inserted?.id ?? null;
  }
}
