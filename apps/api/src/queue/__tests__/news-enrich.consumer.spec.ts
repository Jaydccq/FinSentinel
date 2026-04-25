import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NewsEnrichConsumer } from '../news-enrich.consumer';
import { NewsSentimentService } from '../../news/news-sentiment.service';
import { FirecrawlClient } from '../../scraper/firecrawl.client';
import { DocumentVectorService } from '../../document/document-vector.service';
import type { Job } from 'bullmq';
import type { NewsEnrichJobData } from '../news-enrich.consumer';

// ── Mock factories ─────────────────────────────────────────────────────────

function createMockDb() {
  const selectLimit = vi.fn().mockResolvedValue([
    {
      id: 'news-uuid-1',
      title: 'Fed raises rates by 25bps',
      summary: 'The Federal Reserve raised interest rates by a quarter point.',
      articleUrl: 'https://example.com/article/123',
      source: 'polygon',
      enriched: false,
    },
  ]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    select: selectFn,
    update: updateFn,
    _mocks: { selectFn, selectFrom, selectWhere, selectLimit, updateFn, updateSet, updateWhere },
  };
}

function createMockSentimentService() {
  return {
    classify: vi.fn().mockResolvedValue('NEGATIVE'),
  };
}

function createMockFirecrawl() {
  return {
    scrape: vi
      .fn()
      .mockResolvedValue(
        '# Federal Reserve Rate Decision\n\nThe Federal Reserve raised interest rates by 25 basis points...',
      ),
  };
}

function createMockVectorService() {
  return {
    vectorize: vi.fn().mockResolvedValue(3),
  };
}

function createMockJob(data: NewsEnrichJobData): Job<NewsEnrichJobData> {
  return { data, id: 'job-1', attemptsMade: 0 } as unknown as Job<NewsEnrichJobData>;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NewsEnrichConsumer', () => {
  let consumer: NewsEnrichConsumer;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockSentimentService: ReturnType<typeof createMockSentimentService>;
  let mockFirecrawl: ReturnType<typeof createMockFirecrawl>;
  let mockVectorService: ReturnType<typeof createMockVectorService>;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockSentimentService = createMockSentimentService();
    mockFirecrawl = createMockFirecrawl();
    mockVectorService = createMockVectorService();

    const module = await Test.createTestingModule({
      providers: [
        NewsEnrichConsumer,
        { provide: 'BULLMQ_CONNECTION', useValue: { host: 'localhost', port: 6379 } },
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: NewsSentimentService, useValue: mockSentimentService },
        { provide: FirecrawlClient, useValue: mockFirecrawl },
        { provide: DocumentVectorService, useValue: mockVectorService },
      ],
    }).compile();

    consumer = module.get(NewsEnrichConsumer);
    // Do NOT call onModuleInit — it would try to connect to Redis.
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  it('scrapes article, classifies sentiment, vectorizes, and marks enriched', async () => {
    const job = createMockJob({ newsItemId: 'news-uuid-1' });

    await consumer.process(job);

    // 1. Should scrape the article URL
    expect(mockFirecrawl.scrape).toHaveBeenCalledWith('https://example.com/article/123');

    // 2. Should classify sentiment
    expect(mockSentimentService.classify).toHaveBeenCalledWith(
      'Fed raises rates by 25bps',
      'The Federal Reserve raised interest rates by a quarter point.',
    );

    // 3. Should vectorize the scraped content
    expect(mockVectorService.vectorize).toHaveBeenCalledWith(
      'news-uuid-1',
      expect.stringContaining('Federal Reserve Rate Decision'),
      expect.objectContaining({
        doc_type: 'NEWS',
        source: 'polygon',
        region_id: 'US',
      }),
    );

    // 4. Should update DB: set sentiment and enriched=true
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sentiment: 'NEGATIVE',
        enriched: true,
      }),
    );
  });

  // ── News item not found ────────────────────────────────────────────────

  it('throws when news item is not found in DB', async () => {
    mockDb._mocks.selectLimit.mockResolvedValue([]);

    const job = createMockJob({ newsItemId: 'missing-news' });

    await expect(consumer.process(job)).rejects.toThrow('News item missing-news not found');
  });

  // ── Already enriched ───────────────────────────────────────────────────

  it('skips processing when news item is already enriched', async () => {
    mockDb._mocks.selectLimit.mockResolvedValue([
      {
        id: 'news-uuid-1',
        title: 'Old news',
        summary: 'Already processed',
        articleUrl: 'https://example.com/old',
        source: 'rss',
        enriched: true,
      },
    ]);

    const job = createMockJob({ newsItemId: 'news-uuid-1' });
    await consumer.process(job);

    // Should NOT scrape, classify, or vectorize
    expect(mockFirecrawl.scrape).not.toHaveBeenCalled();
    expect(mockSentimentService.classify).not.toHaveBeenCalled();
    expect(mockVectorService.vectorize).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // ── No article URL ─────────────────────────────────────────────────────

  it('classifies sentiment without scraping when no article URL', async () => {
    mockDb._mocks.selectLimit.mockResolvedValue([
      {
        id: 'news-uuid-2',
        title: 'Breaking: Market crash',
        summary: 'Stocks plunged 10% in early trading.',
        articleUrl: null,
        source: 'x-influencer',
        enriched: false,
      },
    ]);

    const job = createMockJob({ newsItemId: 'news-uuid-2' });
    await consumer.process(job);

    // Should NOT scrape or vectorize
    expect(mockFirecrawl.scrape).not.toHaveBeenCalled();
    expect(mockVectorService.vectorize).not.toHaveBeenCalled();

    // Should still classify sentiment
    expect(mockSentimentService.classify).toHaveBeenCalledWith(
      'Breaking: Market crash',
      'Stocks plunged 10% in early trading.',
    );

    // Should mark as enriched with sentiment
    expect(mockDb._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sentiment: expect.any(String),
        enriched: true,
      }),
    );
  });

  // ── Scrape failure (non-fatal) ─────────────────────────────────────────

  it('continues with sentiment when scraping fails', async () => {
    mockFirecrawl.scrape.mockRejectedValue(new Error('Firecrawl timeout'));
    mockSentimentService.classify.mockResolvedValue('NEUTRAL');

    const job = createMockJob({ newsItemId: 'news-uuid-1' });
    await consumer.process(job);

    // Should still classify sentiment and mark enriched
    expect(mockSentimentService.classify).toHaveBeenCalled();
    expect(mockDb._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sentiment: 'NEUTRAL',
        enriched: true,
      }),
    );

    // Should NOT vectorize (no content)
    expect(mockVectorService.vectorize).not.toHaveBeenCalled();
  });

  // ── Vectorization failure (non-fatal) ──────────────────────────────────

  it('still marks enriched when vectorization fails', async () => {
    mockVectorService.vectorize.mockRejectedValue(new Error('pgvector down'));

    const job = createMockJob({ newsItemId: 'news-uuid-1' });
    await consumer.process(job);

    // Should still update with sentiment + enriched
    expect(mockDb._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sentiment: 'NEGATIVE',
        enriched: true,
      }),
    );
  });

  // ── Null summary ───────────────────────────────────────────────────────

  it('passes null summary to sentiment classifier', async () => {
    mockDb._mocks.selectLimit.mockResolvedValue([
      {
        id: 'news-uuid-3',
        title: 'Quick headline',
        summary: null,
        articleUrl: 'https://example.com/quick',
        source: 'polygon',
        enriched: false,
      },
    ]);

    const job = createMockJob({ newsItemId: 'news-uuid-3' });
    await consumer.process(job);

    expect(mockSentimentService.classify).toHaveBeenCalledWith('Quick headline', null);
  });
});
