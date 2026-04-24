import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WatchlistController } from '../watchlist.controller';
import { WatchlistService } from '../watchlist.service';

describe('WatchlistController', () => {
  let svc: {
    getWatchlist: ReturnType<typeof vi.fn>;
    saveWatchlistItems: ReturnType<typeof vi.fn>;
  };
  let ctrl: WatchlistController;

  beforeEach(() => {
    svc = {
      getWatchlist: vi.fn().mockResolvedValue({ categories: [] }),
      saveWatchlistItems: vi.fn().mockResolvedValue({
        id: 'cat-1',
        name: 'Dashboard',
        key: 'dashboard',
        description: '',
        summary: '',
        itemCount: 1,
        items: [],
        createdAt: '2026-04-24T00:00:00.000Z',
        updatedAt: '2026-04-24T00:00:00.000Z',
      }),
    };
    ctrl = new WatchlistController(svc as unknown as WatchlistService);
  });

  it('GET /watchlist proxies to service.getWatchlist for the current user', async () => {
    const out = await ctrl.list({ userId: 'u-1' } as never);
    expect(svc.getWatchlist).toHaveBeenCalledWith('u-1');
    expect(out.categories).toEqual([]);
  });

  it('POST /watchlist creates/updates a category with items', async () => {
    const body = {
      categoryName: 'Dashboard',
      items: [{ symbol: 'AAPL' }],
    };
    const out = await ctrl.save({ userId: 'u-1' } as never, body as never);
    expect(svc.saveWatchlistItems).toHaveBeenCalledWith('u-1', body);
    expect(out.id).toBe('cat-1');
  });
});
