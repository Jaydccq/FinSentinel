import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { FirecrawlClient } from './firecrawl.client';
import { SecEdgarScraper } from './sec-edgar.scraper';
import { InvestopediaScraper } from './investopedia.scraper';
import { PolygonNewsScraper } from './polygon-news.scraper';
import { KnowledgeBaseScraperService } from './knowledge-base.service';
import { ScraperController } from './scraper.controller';

/**
 * Scraper module -- Phase 12B.
 *
 * Provides:
 * - FirecrawlClient — REST client for Firecrawl web scraping API (retry logic, Bearer auth)
 * - SecEdgarScraper — SEC EDGAR filing scraper
 * - InvestopediaScraper — Investopedia financial terms scraper
 * - PolygonNewsScraper — Polygon.io news article scraper
 * - KnowledgeBaseScraperService — orchestrator that runs all scrapers in parallel
 * - ScraperController — REST endpoints to trigger scrapers
 *
 * All scrapers dedup via the Document table (`originalFileName` check)
 * and will queue vectorization once the producer is implemented.
 */
@Module({
  imports: [AuthModule, CommonModule],
  controllers: [ScraperController],
  providers: [
    FirecrawlClient,
    SecEdgarScraper,
    InvestopediaScraper,
    PolygonNewsScraper,
    KnowledgeBaseScraperService,
  ],
  exports: [
    FirecrawlClient,
    SecEdgarScraper,
    InvestopediaScraper,
    PolygonNewsScraper,
    KnowledgeBaseScraperService,
  ],
})
export class ScraperModule {}
