import { Injectable, Logger } from '@nestjs/common';
import { TwitterDataService } from '../../twitter/twitter-data.service';
import type { NewsFetcher, RawNewsItem } from '../interfaces/news-fetcher';

/**
 * Default crypto/finance influencer handles to track.
 */
const DEFAULT_INFLUENCERS = [
  'caboronmusk',
  'CryptoCapo_',
  'lookonchain',
  'WatcherGuru',
  'whale_alert',
];

/**
 * Shape of a tweet from the 6551.io API response.
 */
interface Tweet {
  id?: string;
  text?: string;
  created_at?: string;
}

interface TweetsResponse {
  data?: Tweet[];
}

/**
 * Fetches tweets from configured crypto/finance influencers via
 * the 6551.io Twitter API and normalises them into RawNewsItem records.
 */
@Injectable()
export class XInfluencerFetcher implements NewsFetcher {
  private readonly logger = new Logger(XInfluencerFetcher.name);
  private readonly influencers: string[];

  constructor(private readonly twitterService: TwitterDataService) {
    this.influencers = DEFAULT_INFLUENCERS;
  }

  getSource(): string {
    return 'X_INFLUENCER';
  }

  async fetch(_tickers: string[]): Promise<RawNewsItem[]> {
    const items: RawNewsItem[] = [];

    for (const handle of this.influencers) {
      try {
        const response = (await this.twitterService.getUserTweets(
          handle,
          10,
          false,
          false,
        )) as TweetsResponse;

        const tweets = response.data ?? [];
        for (const tweet of tweets) {
          if (tweet.id && tweet.text) {
            items.push(this.toRawNewsItem(handle, tweet));
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch tweets for @${handle}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return items;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private toRawNewsItem(handle: string, tweet: Tweet): RawNewsItem {
    return {
      sourceId: `X_${tweet.id}`,
      source: 'X_INFLUENCER',
      title: this.truncate(tweet.text ?? '', 200),
      summary: tweet.text ?? null,
      articleUrl: `https://x.com/${handle}/status/${tweet.id}`,
      author: handle,
      publishedAt: tweet.created_at ?? new Date().toISOString(),
      tickers: this.extractTickers(tweet.text ?? ''),
      tags: ['influencer', handle],
    };
  }

  /**
   * Extract cashtag tickers from tweet text (e.g. $BTC, $ETH).
   */
  private extractTickers(text: string): string[] {
    const matches = text.match(/\$([A-Z]{1,10})/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(1)))];
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }
}
