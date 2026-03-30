import { Injectable, Inject, Logger } from '@nestjs/common';
import { newsItems, eq, and } from '@finsentinel/db';
import type { RawNewsItem, NewsFetcher } from './interfaces/news-fetcher';

/**
 * Orchestrator that polls all registered NewsFetcher implementations,
 * deduplicates against the DB, and persists new items.
 */
@Injectable()
export class NewsFetcherService {
  private readonly logger = new Logger(NewsFetcherService.name);

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    @Inject('NEWS_FETCHERS') private readonly fetchers: NewsFetcher[],
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
          const isNew = await this.saveIfNew(item);
          if (isNew) savedCount++;
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
   * If not, insert it and return true. Otherwise return false.
   */
  private async saveIfNew(item: RawNewsItem): Promise<boolean> {
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
      return false;
    }

    await this.db.insert(newsItems).values({
      sourceId: item.sourceId,
      source: item.source,
      title: item.title,
      summary: item.summary,
      articleUrl: item.articleUrl,
      author: item.author,
      publishedAt: new Date(item.publishedAt),
      tickers: item.tickers,
      tags: item.tags,
    });

    return true;
  }
}
