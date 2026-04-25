import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown?: string;
  };
  error?: string;
}

/**
 * REST client for the Firecrawl web scraping API.
 *
 * POST {baseUrl}/scrape with Bearer token auth.
 * Retry logic: 3 attempts with 1-second backoff.
 */
@Injectable()
export class FirecrawlClient {
  private readonly logger = new Logger(FirecrawlClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 1_000;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('firecrawl.apiKey', '');
    this.baseUrl = configService.get<string>('firecrawl.baseUrl', 'https://api.firecrawl.dev/v2');
  }

  /**
   * Scrape a URL and return its content as markdown.
   * Returns null if the response contains no markdown data.
   * Throws if all retry attempts are exhausted.
   */
  async scrape(url: string): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= FirecrawlClient.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            url,
            formats: ['markdown'],
          }),
        });

        if (!response.ok) {
          const body = (await response.json()) as FirecrawlResponse;
          lastError = new Error(
            `Firecrawl HTTP ${response.status}: ${body.error ?? response.statusText}`,
          );
          this.logger.warn(
            `Firecrawl attempt ${attempt}/${FirecrawlClient.MAX_RETRIES} failed: ${lastError.message}`,
          );

          if (attempt < FirecrawlClient.MAX_RETRIES) {
            await this.sleep(FirecrawlClient.RETRY_DELAY_MS);
          }
          continue;
        }

        const body = (await response.json()) as FirecrawlResponse;
        return body.data?.markdown ?? null;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `Firecrawl attempt ${attempt}/${FirecrawlClient.MAX_RETRIES} error: ${lastError.message}`,
        );

        if (attempt < FirecrawlClient.MAX_RETRIES) {
          await this.sleep(FirecrawlClient.RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Firecrawl scrape failed after ${FirecrawlClient.MAX_RETRIES} attempts for ${url}: ${lastError?.message}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
