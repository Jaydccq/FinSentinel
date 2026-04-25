import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { InvestopediaScraper } from './investopedia.scraper';
import { SecEdgarScraper } from './sec-edgar.scraper';
import { PolygonNewsScraper } from './polygon-news.scraper';
import { KnowledgeBaseScraperService } from './knowledge-base.service';

/**
 * Scraper controller — trigger individual or all scrapers.
 *
 * Each endpoint is rate-limited differently based on scraper cost.
 */
@Controller('scraper')
@UseGuards(JwtGuard)
export class ScraperController {
  constructor(
    private readonly investopedia: InvestopediaScraper,
    private readonly secEdgar: SecEdgarScraper,
    private readonly polygonNews: PolygonNewsScraper,
    private readonly knowledgeBase: KnowledgeBaseScraperService,
  ) {}

  /** POST /scraper/investopedia — scrape Investopedia articles. */
  @Post('investopedia')
  @RateLimit({ limit: 5, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async scrapeInvestopedia() {
    const count = await this.investopedia.scrape();
    return { source: 'investopedia', newDocuments: count };
  }

  /** POST /scraper/sec-filings — scrape SEC EDGAR filings. */
  @Post('sec-filings')
  @RateLimit({ limit: 10, windowSecs: 600 })
  @UseGuards(RateLimitGuard)
  async scrapeSecFilings(@Body() body?: { tickers?: string[] }) {
    const tickers = body?.tickers ?? [];
    const count = await this.secEdgar.scrape(tickers);
    return { source: 'sec-edgar', newDocuments: count };
  }

  /** POST /scraper/news — scrape Polygon news. */
  @Post('news')
  @RateLimit({ limit: 10, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async scrapeNews(@Body() body?: { tickers?: string[] }) {
    const tickers = body?.tickers ?? [];
    const count = await this.polygonNews.scrape(tickers);
    return { source: 'polygon-news', newDocuments: count };
  }

  /** POST /scraper/all — run all scrapers in parallel. */
  @Post('all')
  @RateLimit({ limit: 2, windowSecs: 3600 })
  @UseGuards(RateLimitGuard)
  async scrapeAll(@Body() body?: { tickers?: string[] }) {
    const tickers = body?.tickers ?? [];
    const result = await this.knowledgeBase.scrapeAll(tickers);
    return {
      source: 'all',
      results: result,
      totalNewDocuments: result.secEdgar + result.investopedia + result.polygonNews,
    };
  }
}
