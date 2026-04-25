import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { WatchlistService } from '../watchlist.service';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CATEGORY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ITEM_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-04-16T12:00:00Z');

function createMockDb() {
  const selectResults: unknown[][] = [];

  function makeSelectChain(): {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
  } {
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
      orderBy: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.limit.mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
    chain.orderBy.mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
    chain.where.mockImplementation(() => {
      chain.limit.mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
      chain.orderBy.mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
      const thenableChain = {
        ...chain,
        then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
          Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
      };
      return thenableChain;
    });
    return chain;
  }

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    _insertChain: insertChain,
    _updateChain: updateChain,
    enqueueSelect(...results: unknown[][]) {
      for (const result of results) {
        selectResults.push(result);
      }
    },
  };
}

describe('WatchlistService', () => {
  let service: WatchlistService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      providers: [
        WatchlistService,
        {
          provide: 'DRIZZLE_DB',
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get(WatchlistService);
  });

  it('creates a category and saves deduplicated items', async () => {
    mockDb.enqueueSelect([]);
    mockDb._insertChain.returning.mockResolvedValueOnce([
      {
        id: CATEGORY_ID,
        userId: USER_ID,
        name: '电',
        key: '电',
        description: '电力',
        summary: '先看核电和独立发电商。',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    mockDb.enqueueSelect([]);
    mockDb.enqueueSelect([
      {
        id: CATEGORY_ID,
        userId: USER_ID,
        name: '电',
        key: '电',
        description: '电力',
        summary: '先看核电和独立发电商。',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    mockDb.enqueueSelect([
      {
        id: ITEM_ID,
        userId: USER_ID,
        categoryId: CATEGORY_ID,
        symbol: 'CEG',
        companyName: 'Constellation Energy',
        thesis: '核电资产稀缺',
        notes: '回调关注',
        priority: 90,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const result = await service.saveWatchlistItems(USER_ID, {
      categoryName: '电',
      categoryDescription: '电力',
      categorySummary: '先看核电和独立发电商。',
      items: [
        {
          symbol: 'ceg',
          companyName: 'Constellation Energy',
          thesis: '核电资产稀缺',
          priority: 90,
        },
        { symbol: 'CEG', notes: '回调关注' },
      ],
    });

    expect(result.name).toBe('电');
    expect(result.itemCount).toBe(1);
    expect(result.items[0]?.symbol).toBe('CEG');
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('updates existing category summary and item notes during organization', async () => {
    mockDb.enqueueSelect([
      {
        id: CATEGORY_ID,
        userId: USER_ID,
        name: '油',
        key: '油',
        description: '原油和油服',
        summary: '旧摘要',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    mockDb._updateChain.returning.mockResolvedValueOnce([
      {
        id: CATEGORY_ID,
        userId: USER_ID,
        name: '油',
        key: '油',
        description: '原油和油服',
        summary: '新摘要',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    mockDb.enqueueSelect([
      {
        id: ITEM_ID,
        userId: USER_ID,
        categoryId: CATEGORY_ID,
        symbol: 'XOM',
        companyName: 'Exxon Mobil',
        thesis: '旧逻辑',
        notes: '旧笔记',
        priority: 50,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    mockDb.enqueueSelect([
      {
        id: CATEGORY_ID,
        userId: USER_ID,
        name: '油',
        key: '油',
        description: '原油和油服',
        summary: '新摘要',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    mockDb.enqueueSelect([
      {
        id: ITEM_ID,
        userId: USER_ID,
        categoryId: CATEGORY_ID,
        symbol: 'XOM',
        companyName: 'Exxon Mobil',
        thesis: '自由现金流强',
        notes: '油价回落时观察回补',
        priority: 70,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const result = await service.organizeWatchlistCategory(USER_ID, {
      categoryName: '油',
      categorySummary: '新摘要',
      items: [
        {
          symbol: 'XOM',
          thesis: '自由现金流强',
          notes: '油价回落时观察回补',
          priority: 70,
        },
      ],
    });

    expect(result.summary).toBe('新摘要');
    expect(result.items[0]?.notes).toContain('观察');
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it('returns an empty overview when no categories exist', async () => {
    mockDb.enqueueSelect([]);

    const result = await service.getWatchlist(USER_ID);

    expect(result.categories).toEqual([]);
  });
});
