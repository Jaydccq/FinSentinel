import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Individual article returned by the 6551.io crypto news API.
 */
export interface CryptoNewsArticle {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  author?: string;
  published_at: string;
  tickers?: string[];
  tags?: string[];
  ai_score?: number;
  ai_signal?: string;
}

/**
 * 6551.io crypto news search response.
 */
interface CryptoNewsSearchResponse {
  data?: CryptoNewsArticle[];
}

/**
 * REST client for the 6551.io crypto news API.
 *
 * POST https://ai.6551.io/open/news_search
 * Auth: Bearer token
 */
@Injectable()
export class CryptoNewsApiClient {
  private readonly logger = new Logger(CryptoNewsApiClient.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.get<string>(
      'CRYPTO_NEWS_6551_BASE_URL',
      'https://ai.6551.io',
    );
    this.token = configService.get<string>('CRYPTO_NEWS_6551_TOKEN', '');
  }

  /**
   * Search for crypto news articles.
   *
   * @param query  - Search query (ticker symbols or keywords)
   * @param limit  - Max results (default 20)
   */
  async searchNews(
    query: string,
    limit = 20,
  ): Promise<CryptoNewsArticle[]> {
    if (!this.token) {
      this.logger.warn('CRYPTO_NEWS_6551_TOKEN not set — skipping search');
      return [];
    }

    const url = `${this.baseUrl}/open/news_search`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, limit }),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `6551 crypto news API error: ${response.status} ${response.statusText} — ${text}`,
      );
      throw new Error(
        `6551 crypto news API returned ${response.status}: ${text}`,
      );
    }

    const body = (await response.json()) as CryptoNewsSearchResponse;
    return body.data ?? [];
  }
}
