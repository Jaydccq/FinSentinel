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

describe('NewsController', () => {
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
