import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { documents, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { FirecrawlClient } from './firecrawl.client';
import { VectorizeProducer } from '../queue/vectorize.producer';

interface PolygonNewsResponse {
  results: Array<{
    id: string;
    title: string;
    article_url: string;
    author: string;
    published_utc: string;
    description?: string;
    tickers?: string[];
  }>;
  status: string;
  count: number;
}

/**
 * Polygon.io news scraper — fetches news articles from Polygon API.
 *
 * For each article, scrapes full content via Firecrawl if URL is available,
 * saves to Document table, and queues for vectorization.
 */
@Injectable()
export class PolygonNewsScraper {
  private readonly logger = new Logger(PolygonNewsScraper.name);
  private readonly apiKey: string;

  private static readonly BASE_URL = 'https://api.polygon.io/v2/reference/news';

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly firecrawl: FirecrawlClient,
    configService: ConfigService,
    @Optional() private readonly vectorizeProducer?: VectorizeProducer,
  ) {
    this.apiKey = configService.get<string>('polygon.apiKey', '');
  }

  /**
   * Scrape news articles for the given tickers.
   * Returns the count of newly saved documents.
   */
  async scrape(tickers: string[]): Promise<number> {
    let savedCount = 0;

    for (const ticker of tickers) {
      try {
        const count = await this.scrapeForTicker(ticker);
        savedCount += count;
      } catch (err) {
        this.logger.error(
          `Polygon news scrape failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return savedCount;
  }

  private async scrapeForTicker(ticker: string): Promise<number> {
    const url = new URL(PolygonNewsScraper.BASE_URL);
    url.searchParams.set('ticker', ticker);
    url.searchParams.set('limit', '10');
    url.searchParams.set('apiKey', this.apiKey);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Polygon API returned ${response.status}`);
    }

    const data = (await response.json()) as PolygonNewsResponse;
    const articles = data.results ?? [];

    this.logger.log(`Polygon found ${articles.length} news articles for ${ticker}`);

    let savedCount = 0;

    for (const article of articles) {
      const originalFileName = `polygon-news-${article.id}`;

      // Dedup: skip if document already exists
      const existing = await this.db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.originalFileName, originalFileName))
        .limit(1);

      if (existing.length > 0) {
        continue;
      }

      if (!article.article_url) {
        continue;
      }

      try {
        const markdown = await this.firecrawl.scrape(article.article_url);
        if (!markdown) {
          this.logger.warn(`No content scraped for article ${article.id}`);
          continue;
        }

        const [inserted] = await this.db
          .insert(documents)
          .values({
            fileName: `${ticker}-news-${article.id}.md`,
            originalFileName,
            docType: 'NEWS_ARTICLE',
            status: 'PENDING',
            sector: null,
            regionId: 'US',
            fileSize: Buffer.byteLength(markdown, 'utf-8'),
          })
          .returning({ id: documents.id });

        if (inserted?.id && this.vectorizeProducer) {
          await this.vectorizeProducer.send(inserted.id);
          this.logger.log(`Enqueued vectorization for doc ${inserted.id}`);
        }
        savedCount++;
      } catch (err) {
        this.logger.warn(
          `Failed to scrape article ${article.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return savedCount;
  }
}
