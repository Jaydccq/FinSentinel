import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { KnowledgeBaseScraperService } from '../knowledge-base.service';
import { SecEdgarScraper } from '../sec-edgar.scraper';
import { InvestopediaScraper } from '../investopedia.scraper';
import { PolygonNewsScraper } from '../polygon-news.scraper';

describe('KnowledgeBaseScraperService', () => {
  let service: KnowledgeBaseScraperService;
  let secEdgar: { scrape: ReturnType<typeof vi.fn> };
  let investopedia: { scrape: ReturnType<typeof vi.fn> };
  let polygonNews: { scrape: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    secEdgar = { scrape: vi.fn().mockResolvedValue(5) };
    investopedia = { scrape: vi.fn().mockResolvedValue(10) };
    polygonNews = { scrape: vi.fn().mockResolvedValue(3) };

    const module = await Test.createTestingModule({
      providers: [
        KnowledgeBaseScraperService,
        { provide: SecEdgarScraper, useValue: secEdgar },
        { provide: InvestopediaScraper, useValue: investopedia },
        { provide: PolygonNewsScraper, useValue: polygonNews },
      ],
    }).compile();

    service = module.get(KnowledgeBaseScraperService);
  });

  // ── Test: scrapeAll runs all scrapers in parallel ───────────────────────

  it('scrapeAll returns combined results from all scrapers', async () => {
    const result = await service.scrapeAll(['AAPL', 'TSLA']);

    expect(result).toEqual({
      secEdgar: 5,
      investopedia: 10,
      polygonNews: 3,
    });

    expect(secEdgar.scrape).toHaveBeenCalledWith(['AAPL', 'TSLA']);
    expect(investopedia.scrape).toHaveBeenCalledWith(undefined);
    expect(polygonNews.scrape).toHaveBeenCalledWith(['AAPL', 'TSLA']);
  });

  // ── Test: individual scraper failure doesn't block others ───────────────

  it('handles individual scraper failures gracefully', async () => {
    secEdgar.scrape.mockRejectedValue(new Error('SEC EDGAR down'));

    const result = await service.scrapeAll(['AAPL']);

    expect(result).toEqual({
      secEdgar: 0,
      investopedia: 10,
      polygonNews: 3,
    });
  });

  // ── Test: all scrapers fail ─────────────────────────────────────────────

  it('returns all zeros when all scrapers fail', async () => {
    secEdgar.scrape.mockRejectedValue(new Error('fail'));
    investopedia.scrape.mockRejectedValue(new Error('fail'));
    polygonNews.scrape.mockRejectedValue(new Error('fail'));

    const result = await service.scrapeAll([]);

    expect(result).toEqual({
      secEdgar: 0,
      investopedia: 0,
      polygonNews: 0,
    });
  });

  // ── Test: default tickers ───────────────────────────────────────────────

  it('scrapeAll uses empty array when no tickers provided', async () => {
    await service.scrapeAll();

    expect(secEdgar.scrape).toHaveBeenCalledWith([]);
    expect(polygonNews.scrape).toHaveBeenCalledWith([]);
  });
});
