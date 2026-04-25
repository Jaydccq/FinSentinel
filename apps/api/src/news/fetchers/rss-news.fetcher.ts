import { Injectable, Logger } from '@nestjs/common';
import RssParser from 'rss-parser';
import type { NewsFetcher, RawNewsItem } from '../interfaces/news-fetcher';

/**
 * Default RSS feeds — financial news outlets.
 */
const DEFAULT_FEEDS: ReadonlyArray<{ name: string; url: string }> = [
  { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { name: 'Reuters_Business', url: 'https://feeds.reuters.com/reuters/businessNews' },
];

/**
 * Fetches and parses RSS feeds from configured financial news outlets.
 *
 * Uses `rss-parser` for XML → JSON mapping, then normalises entries
 * into RawNewsItem records with source="RSS".
 */
@Injectable()
export class RssNewsFetcher implements NewsFetcher {
  private readonly logger = new Logger(RssNewsFetcher.name);
  private readonly parser = new RssParser();
  private readonly feeds: ReadonlyArray<{ name: string; url: string }>;

  constructor() {
    this.feeds = DEFAULT_FEEDS;
  }

  getSource(): string {
    return 'RSS';
  }

  async fetch(_tickers: string[]): Promise<RawNewsItem[]> {
    const items: RawNewsItem[] = [];

    for (const feed of this.feeds) {
      try {
        const parsed = await this.parser.parseURL(feed.url);
        for (const entry of parsed.items ?? []) {
          items.push(this.toRawNewsItem(feed.name, entry));
        }
      } catch (err) {
        this.logger.warn(
          `Failed to parse RSS feed ${feed.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return items;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private toRawNewsItem(feedName: string, entry: RssParser.Item): RawNewsItem {
    const guid = entry.guid ?? entry.link ?? entry.title ?? '';

    return {
      sourceId: `RSS_${feedName}_${this.hashString(guid)}`,
      source: 'RSS',
      title: entry.title ?? '(no title)',
      summary: entry.contentSnippet ?? entry.content ?? null,
      articleUrl: entry.link ?? null,
      author: entry.creator ?? null,
      publishedAt: entry.isoDate ?? new Date().toISOString(),
      tickers: [],
      tags: entry.categories ?? [],
    };
  }

  /**
   * Simple string hash for deterministic sourceId generation.
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(36);
  }
}
