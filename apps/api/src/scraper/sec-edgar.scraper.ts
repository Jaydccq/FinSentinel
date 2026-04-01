import { Injectable, Inject, Logger } from '@nestjs/common';
import { documents, eq } from '@finsentinel/db';
import { FirecrawlClient } from './firecrawl.client';

interface EdgarSearchResult {
  hits: {
    hits: Array<{
      _id: string;
      _source: {
        file_date: string;
        display_date_filed: string;
        entity_name: string;
        file_num: string;
        form_type: string;
        file_description?: string;
      };
    }>;
  };
}

/**
 * SEC EDGAR scraper — fetches SEC filings via the EDGAR full-text search API.
 *
 * For each filing result, downloads full text via Firecrawl,
 * saves to Document table, and queues for vectorization.
 */
@Injectable()
export class SecEdgarScraper {
  private readonly logger = new Logger(SecEdgarScraper.name);

  private static readonly EDGAR_SEARCH_URL =
    'https://efts.sec.gov/LATEST/search-index';
  private static readonly USER_AGENT =
    'FinSentinel/1.0 (contact@finsentinel.com)';
  private static readonly FORMS = '10-K,10-Q,8-K';

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    private readonly firecrawl: FirecrawlClient,
  ) {}

  /**
   * Scrape SEC filings for the given tickers.
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
          `SEC EDGAR scrape failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return savedCount;
  }

  private async scrapeForTicker(ticker: string): Promise<number> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    const startdt = oneYearAgo.toISOString().split('T')[0];
    const enddt = now.toISOString().split('T')[0];

    const url = new URL(SecEdgarScraper.EDGAR_SEARCH_URL);
    url.searchParams.set('q', ticker);
    url.searchParams.set('dateRange', 'custom');
    url.searchParams.set('startdt', startdt!);
    url.searchParams.set('enddt', enddt!);
    url.searchParams.set('forms', SecEdgarScraper.FORMS);

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': SecEdgarScraper.USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(`EDGAR API returned ${response.status}`);
    }

    const data = (await response.json()) as EdgarSearchResult;
    const hits = data.hits?.hits ?? [];

    this.logger.log(
      `SEC EDGAR found ${hits.length} filings for ${ticker}`,
    );

    let savedCount = 0;

    for (const hit of hits) {
      const originalFileName = `sec-edgar-${hit._id}`;

      // Dedup: skip if document already exists
      const existing = await this.db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.originalFileName, originalFileName))
        .limit(1);

      if (existing.length > 0) {
        continue;
      }

      // Build the EDGAR filing URL
      const filingUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=${hit._source.form_type}&dateb=&owner=include&count=1`;

      try {
        const markdown = await this.firecrawl.scrape(filingUrl);
        if (!markdown) {
          this.logger.warn(`No content scraped for filing ${hit._id}`);
          continue;
        }

        const [inserted] = await this.db
          .insert(documents)
          .values({
            fileName: `${ticker}-${hit._source.form_type}-${hit._source.file_date}.md`,
            originalFileName,
            docType: 'SEC_FILING',
            status: 'PENDING',
            sector: null,
            regionId: 'US',
            fileSize: Buffer.byteLength(markdown, 'utf-8'),
          })
          .returning({ id: documents.id });

        this.logger.log(
          `TODO: queue vectorization for doc ${inserted.id}`,
        );
        savedCount++;
      } catch (err) {
        this.logger.warn(
          `Failed to scrape filing ${hit._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return savedCount;
  }
}
