import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NewsFetcher, RawNewsItem } from '../interfaces/news-fetcher';

/**
 * Polygon.io news reference response shape (subset).
 */
interface PolygonNewsArticle {
  id: string;
  title: string;
  description?: string;
  article_url?: string;
  author?: string;
  published_utc: string;
  tickers?: string[];
  image_url?: string;
  keywords?: string[];
}

interface PolygonNewsResponse {
  results?: PolygonNewsArticle[];
  status?: string;
}

/**
 * Fetches news articles from the Polygon.io REST API.
 *
 * GET https://api.polygon.io/v2/reference/news?ticker={tickers}&limit=10&apiKey={key}
 */
@Injectable()
export class PolygonNewsFetcher implements NewsFetcher {
  private readonly logger = new Logger(PolygonNewsFetcher.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.polygon.io';

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('POLYGON_API_KEY', '');
  }

  getSource(): string {
    return 'POLYGON';
  }

  async fetch(tickers: string[]): Promise<RawNewsItem[]> {
    if (!this.apiKey) {
      this.logger.warn('POLYGON_API_KEY not set — skipping fetch');
      return [];
    }

    const url = this.buildUrl(tickers);

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `Polygon news API error: ${response.status} ${response.statusText} — ${text}`,
      );
      throw new Error(`Polygon news API returned ${response.status}: ${text}`);
    }

    const data = (await response.json()) as PolygonNewsResponse;
    const articles = data.results ?? [];

    return articles.map((article) => this.toRawNewsItem(article));
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private buildUrl(tickers: string[]): string {
    const params = new URLSearchParams({
      limit: '10',
      apiKey: this.apiKey,
    });

    if (tickers.length > 0) {
      params.set('ticker', tickers.join(','));
    }

    return `${this.baseUrl}/v2/reference/news?${params.toString()}`;
  }

  private toRawNewsItem(article: PolygonNewsArticle): RawNewsItem {
    return {
      sourceId: article.id,
      source: 'POLYGON',
      title: article.title,
      summary: article.description ?? null,
      articleUrl: article.article_url ?? null,
      author: article.author ?? null,
      publishedAt: article.published_utc,
      tickers: article.tickers ?? [],
      tags: article.keywords ?? [],
    };
  }
}
