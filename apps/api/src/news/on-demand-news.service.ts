import { Injectable, Inject, Logger } from '@nestjs/common';
import { newsItems, eq, and } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import type { NewsFetcher, RawNewsItem } from './interfaces/news-fetcher';

/**
 * Fetches news on-demand for specific tickers (not scheduled).
 *
 * Called by NewsController when a user queries a ticker that has no
 * cached news. Calls all registered fetchers, deduplicates by sourceId,
 * and persists new items to the DB.
 */
@Injectable()
export class OnDemandNewsService {
  private readonly logger = new Logger(OnDemandNewsService.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    @Inject('NEWS_FETCHERS') private readonly fetchers: NewsFetcher[],
  ) {}

  /**
   * Fetch news for the given tickers from all sources, dedup, and persist.
   *
   * @returns Count of newly persisted items.
   */
  async fetchForTickers(tickers: string[]): Promise<number> {
    if (tickers.length === 0) return 0;

    const allItems: RawNewsItem[] = [];
    const seen = new Set<string>();

    // Collect from all fetchers
    for (const fetcher of this.fetchers) {
      try {
        const items = await fetcher.fetch(tickers);
        for (const item of items) {
          const key = `${item.source}:${item.sourceId}`;
          if (!seen.has(key)) {
            seen.add(key);
            allItems.push(item);
          }
        }
      } catch (err) {
        this.logger.error(
          `On-demand fetcher ${fetcher.getSource()} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Persist only new items
    let savedCount = 0;
    for (const item of allItems) {
      const existing = await this.db
        .select({ id: newsItems.id })
        .from(newsItems)
        .where(and(eq(newsItems.source, item.source), eq(newsItems.sourceId, item.sourceId)))
        .limit(1);

      if (existing.length === 0) {
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
        savedCount++;
      }
    }

    this.logger.log(
      `On-demand fetch for [${tickers.join(', ')}]: ${savedCount} new items saved (${allItems.length} total fetched)`,
    );

    return savedCount;
  }
}
