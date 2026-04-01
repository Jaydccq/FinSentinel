import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NewsFetcherService } from '../news-fetcher.service';
import type { NewsFetcher, RawNewsItem } from '../interfaces/news-fetcher';

// ── Constants ──────────────────────────────────────────────────────────────
const NOW_ISO = '2026-03-30T12:00:00Z';

function makeRawItem(overrides: Partial<RawNewsItem> = {}): RawNewsItem {
  return {
    sourceId: 'article-001',
    source: 'POLYGON',
    title: 'AAPL beats earnings',
    summary: 'Apple reported Q1 results...',
    articleUrl: 'https://example.com/article-001',
    author: 'John Doe',
    publishedAt: NOW_ISO,
    tickers: ['AAPL'],
    tags: ['earnings'],
    ...overrides,
  };
}

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
function createMockDb() {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };

  const insertReturning = vi.fn().mockResolvedValue([{ id: 'new-item-id' }]);
  const insertChain = {
    values: vi.fn().mockReturnValue({ returning: insertReturning }),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
  };
}

// ── Mock Fetcher ────────────────────────────────────────────────────────────
function createMockFetcher(source: string, items: RawNewsItem[]): NewsFetcher {
  return {
    getSource: () => source,
    fetch: vi.fn().mockResolvedValue(items),
  };
}

describe('NewsFetcherService', () => {
  let service: NewsFetcherService;
  let mockDb: ReturnType<typeof createMockDb>;

  function buildModule(fetchers: NewsFetcher[]) {
    mockDb = createMockDb();

    return Test.createTestingModule({
      providers: [
        NewsFetcherService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: 'NEWS_FETCHERS', useValue: fetchers },
      ],
    }).compile();
  }

  // ── Test: no fetchers ────────────────────────────────────────────────────

  it('pollAll with no fetchers returns 0', async () => {
    const module = await buildModule([]);
    service = module.get(NewsFetcherService);

    const count = await service.pollAll();

    expect(count).toBe(0);
  });

  // ── Test: deduplication ──────────────────────────────────────────────────

  it('pollAll deduplicates existing items', async () => {
    const fetcher = createMockFetcher('POLYGON', [makeRawItem()]);
    const module = await buildModule([fetcher]);
    service = module.get(NewsFetcherService);

    // DB says item already exists
    mockDb._selectChain.limit.mockResolvedValueOnce([{ id: 'existing-id' }]);

    const count = await service.pollAll();

    expect(count).toBe(0);
    // Select was called to check existence
    expect(mockDb.select).toHaveBeenCalled();
    // Insert was NOT called since item is a duplicate
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── Test: saves new items ────────────────────────────────────────────────

  it('pollAll saves new items', async () => {
    const items = [
      makeRawItem({ sourceId: 'new-001' }),
      makeRawItem({ sourceId: 'new-002', title: 'TSLA rallies' }),
    ];
    const fetcher = createMockFetcher('POLYGON', items);
    const module = await buildModule([fetcher]);
    service = module.get(NewsFetcherService);

    // Both items are new (select returns empty)
    mockDb._selectChain.limit.mockResolvedValue([]);

    const count = await service.pollAll();

    expect(count).toBe(2);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  // ── Test: getSource ──────────────────────────────────────────────────────

  it('getSource returns correct source identifier', () => {
    const fetcher = createMockFetcher('RSS_CNBC', []);
    expect(fetcher.getSource()).toBe('RSS_CNBC');
  });
});
