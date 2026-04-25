import { Injectable, Logger } from '@nestjs/common';
import { SecEdgarScraper } from './sec-edgar.scraper';
import { InvestopediaScraper } from './investopedia.scraper';
import { PolygonNewsScraper } from './polygon-news.scraper';

export interface ScrapeResult {
  secEdgar: number;
  investopedia: number;
  polygonNews: number;
}

/**
 * Orchestrator that runs all scrapers in parallel.
 *
 * Uses `Promise.allSettled()` so that individual scraper failures
 * do not block the others.
 */
@Injectable()
export class KnowledgeBaseScraperService {
  private readonly logger = new Logger(KnowledgeBaseScraperService.name);

  constructor(
    private readonly secEdgar: SecEdgarScraper,
    private readonly investopedia: InvestopediaScraper,
    private readonly polygonNews: PolygonNewsScraper,
  ) {}

  /**
   * Run all scrapers in parallel.
   * @param tickers - tickers for SEC EDGAR and Polygon scrapers
   * @returns counts of new documents from each scraper
   */
  async scrapeAll(tickers: string[] = []): Promise<ScrapeResult> {
    const [secResult, investResult, polygonResult] = await Promise.allSettled([
      this.secEdgar.scrape(tickers),
      this.investopedia.scrape(undefined),
      this.polygonNews.scrape(tickers),
    ]);

    const secEdgar = this.extractCount(secResult, 'SecEdgar');
    const investopedia = this.extractCount(investResult, 'Investopedia');
    const polygonNews = this.extractCount(polygonResult, 'PolygonNews');

    this.logger.log(
      `Scrape complete — SEC: ${secEdgar}, Investopedia: ${investopedia}, Polygon: ${polygonNews}`,
    );

    return { secEdgar, investopedia, polygonNews };
  }

  private extractCount(result: PromiseSettledResult<number>, label: string): number {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    this.logger.error(
      `${label} scraper failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
    return 0;
  }
}
