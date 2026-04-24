import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../client', () => ({
  resolveBase: () => '/api',
  authHeaders: () => ({ Authorization: 'Bearer test' }),
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import('../client');
const { watchlistApi } = await import('../watchlist');

describe('watchlistApi', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('list() GETs /watchlist via apiFetch', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      categories: [],
    });
    const out = await watchlistApi.list();
    expect(apiFetch).toHaveBeenCalledWith('/watchlist');
    expect(out).toEqual({ categories: [] });
  });

  it('save() POSTs to /watchlist with the JSON body', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'cat-1',
      name: 'Dashboard',
      key: 'dashboard',
      description: '',
      summary: '',
      itemCount: 1,
      items: [],
      createdAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T00:00:00.000Z',
    });
    const body = {
      categoryName: 'Dashboard',
      items: [{ symbol: 'AAPL' }],
    };
    await watchlistApi.save(body);
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/watchlist');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });
});
