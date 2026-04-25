import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../client', () => ({
  resolveBase: () => '/api',
  authHeaders: () => ({ Authorization: 'Bearer test' }),
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const { apiFetch } = await import('../client');
const { watchlistApi } = await import('../watchlist');
const { ResponseValidationError } = await import('../typed-client');

const validCategory = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Dashboard',
  key: 'dashboard',
  description: '',
  summary: '',
  itemCount: 0,
  items: [],
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
};

describe('watchlistApi', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('list() GETs /watchlist via apiFetch', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      categories: [],
    });
    const out = await watchlistApi.list();
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/watchlist');
    expect((call[1] as RequestInit).method).toBe('GET');
    expect(out).toEqual({ categories: [] });
  });

  it('save() POSTs to /watchlist with the JSON body', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validCategory);
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

  it('updateItem() PATCHes /watchlist/items/:id with URL-encoded id', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: '22222222-2222-2222-2222-222222222222',
      symbol: 'AAPL',
      companyName: 'Apple',
      thesis: '',
      notes: '',
      priority: 0,
      createdAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T00:00:00.000Z',
    });
    await watchlistApi.updateItem('item id', { notes: 'hi' });
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/watchlist/items/item%20id');
    expect((call[1] as RequestInit).method).toBe('PATCH');
  });

  it('deleteItem() DELETEs /watchlist/items/:id', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await watchlistApi.deleteItem('abc');
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/watchlist/items/abc');
    expect((call[1] as RequestInit).method).toBe('DELETE');
  });

  it('throws ResponseValidationError when watchlist list returns malformed data', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: 'not-an-array',
    });
    await expect(watchlistApi.list()).rejects.toBeInstanceOf(ResponseValidationError);
  });
});
