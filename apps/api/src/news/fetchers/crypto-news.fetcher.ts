import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NewsFetcher, RawNewsItem } from '../interfaces/news-fetcher';
import { CryptoNewsApiClient, type CryptoNewsArticle } from './crypto-news-api.client';

/**
 * Fetches crypto news from the 6551.io API and filters by AI score.
 *
 * Only articles with aiScore >= minAiScore (default 70) are returned
 * to avoid injecting low-quality noise into the RAG pipeline.
 */
@Injectable()
export class CryptoNewsFetcher implements NewsFetcher {
  private readonly logger = new Logger(CryptoNewsFetcher.name);
  private readonly minAiScore: number;

  constructor(
    private readonly apiClient: CryptoNewsApiClient,
    configService: ConfigService,
  ) {
    this.minAiScore = configService.get<number>('CRYPTO_NEWS_MIN_SCORE', 70);
  }

  getSource(): string {
    return 'CRYPTO_6551';
  }

  async fetch(tickers: string[]): Promise<RawNewsItem[]> {
    const query = tickers.length > 0 ? tickers.join(' ') : 'crypto';

    try {
      const articles = await this.apiClient.searchNews(query);

      return articles
        .filter((a) => (a.ai_score ?? 0) >= this.minAiScore)
        .map((a) => this.toRawNewsItem(a));
    } catch (err) {
      this.logger.error(
        `CryptoNewsFetcher failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private toRawNewsItem(article: CryptoNewsArticle): RawNewsItem {
    return {
      sourceId: article.id,
      source: 'CRYPTO_6551',
      title: article.title,
      summary: article.summary ?? null,
      articleUrl: article.url ?? null,
      author: article.author ?? null,
      publishedAt: article.published_at,
      tickers: article.tickers ?? [],
      tags: article.tags ?? [],
    };
  }
}
