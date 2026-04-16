import { describe, it, expect, vi } from 'vitest';
import { NewsController } from '../news.controller';

function createMockDb(rows: Array<Record<string, unknown>>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });

  return {
    select: vi.fn().mockReturnValue({ from }),
  };
}

function createRowsSelectResult(rows: Array<Record<string, unknown>>) {
  const offset = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockReturnValue({ offset });
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where, orderBy });

  return { from, where, orderBy, limit, offset };
}

function createCountSelectResult(count: number, useWhere = false) {
  const result = [{ count }];
  const where = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue(useWhere ? { where } : result);

  return { from, where };
}

describe('NewsController', () => {
  it('refreshes the global news feed when the first page is stale', async () => {
    const staleRow = {
      id: 'stale-news-1',
      publishedAt: new Date('2026-02-28T12:00:00.000Z'),
    };
    const freshRow = {
      id: 'fresh-news-1',
      publishedAt: new Date('2026-04-16T15:55:00.000Z'),
    };

    const staleRowsQuery = createRowsSelectResult([staleRow]);
    const freshRowsQuery = createRowsSelectResult([freshRow]);
    const countQuery = createCountSelectResult(1);
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(staleRowsQuery)
        .mockReturnValueOnce(freshRowsQuery)
        .mockReturnValueOnce(countQuery),
    };
    const pollAll = vi.fn().mockResolvedValue(1);
    const controller = new NewsController(
      mockDb as never,
      { fetchForTickers: vi.fn() } as never,
      { reindexMissingNews: vi.fn() } as never,
      { pollAll } as never,
    );

    const result = await controller.getNews('0', '50');

    expect(pollAll).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([freshRow]);
  });

  it('refreshes ticker news when the freshest cached item is stale', async () => {
    const staleRow = {
      id: 'stale-aapl-news-1',
      publishedAt: new Date('2026-02-28T12:00:00.000Z'),
      tickers: ['AAPL'],
    };
    const freshRow = {
      id: 'fresh-aapl-news-1',
      publishedAt: new Date('2026-04-16T15:55:00.000Z'),
      tickers: ['AAPL'],
    };

    const staleRowsQuery = createRowsSelectResult([staleRow]);
    const freshRowsQuery = createRowsSelectResult([freshRow]);
    const countQuery = createCountSelectResult(1, true);
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(staleRowsQuery)
        .mockReturnValueOnce(freshRowsQuery)
        .mockReturnValueOnce(countQuery),
    };
    const fetchForTickers = vi.fn().mockResolvedValue(1);
    const controller = new NewsController(
      mockDb as never,
      { fetchForTickers } as never,
      { reindexMissingNews: vi.fn() } as never,
      { pollAll: vi.fn() } as never,
    );

    const result = await controller.getByTicker('AAPL', '0', '20');

    expect(fetchForTickers).toHaveBeenCalledWith(['AAPL']);
    expect(result.content).toEqual([freshRow]);
  });

  it('emits news items followed by a heartbeat event', async () => {
    const newsRow = {
      id: 'news-1',
      sourceId: 'source-1',
      source: 'POLYGON',
      title: 'Apple jumps after earnings',
      summary: 'Revenue beat expectations.',
      articleUrl: 'https://example.com/apple',
      author: 'Reporter',
      publishedAt: new Date('2026-04-04T12:00:00.000Z'),
      tickers: ['AAPL'],
      tags: ['earnings'],
      sentiment: 'POSITIVE',
      enriched: true,
      createdAt: new Date('2026-04-04T12:00:00.000Z'),
    };
    const mockDb = createMockDb([newsRow]);
    const controller = new NewsController(
      mockDb as never,
      { fetchForTickers: vi.fn() } as never,
      { reindexMissingNews: vi.fn() } as never,
      { pollAll: vi.fn() } as never,
    );

    const events = await new Promise<Array<{ type?: string; data: unknown }>>((resolve, reject) => {
      const collected: Array<{ type?: string; data: unknown }> = [];
      const subscription = controller.streamNews().subscribe({
        next: (event) => {
          collected.push({ type: event.type, data: event.data });
          if (collected.length === 2) {
            subscription.unsubscribe();
            resolve(collected);
          }
        },
        error: reject,
      });
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'news',
      data: expect.objectContaining({
        id: 'news-1',
        title: 'Apple jumps after earnings',
      }),
    });
    expect(events[1]).toMatchObject({
      type: 'heartbeat',
      data: expect.objectContaining({
        delivered: 1,
      }),
    });
  });
});
