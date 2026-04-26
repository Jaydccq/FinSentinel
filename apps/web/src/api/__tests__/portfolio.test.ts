import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../client', () => ({
  resolveBase: () => '/api',
  authHeaders: () => ({}),
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
const { portfolioApi } = await import('../portfolio');
const { ResponseValidationError } = await import('../typed-client');

const validHolding = {
  id: '11111111-1111-1111-1111-111111111111',
  symbol: 'AAPL',
  companyName: 'Apple',
  quantity: '10.0000',
  averageCost: '150.00',
  currentPrice: '170.00',
  sector: 'Technology',
};

const validPortfolio = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Growth',
  description: '',
  totalValue: '1700.00',
  holdings: [validHolding],
  createdAt: '2026-04-24T00:00:00.000Z',
  valuedAt: null,
};

describe('portfolioApi', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('list() GETs /portfolios and accepts decimal-string fields', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([validPortfolio]);
    const out = await portfolioApi.list();
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/portfolios');
    expect((call[1] as RequestInit).method).toBe('GET');
    expect(out).toEqual([validPortfolio]);
  });

  it('get() GETs /portfolios/:id with URL-encoded id', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validPortfolio);
    await portfolioApi.get('abc 1');
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/portfolios/abc%201');
  });

  it('create() POSTs /portfolios with the JSON body', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validPortfolio);
    await portfolioApi.create({ name: 'Growth', description: 'long term' });
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/portfolios');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Growth', description: 'long term' });
  });

  it('rejects portfolio response when totalValue is a number (decimal-string drift)', async () => {
    // The shared schema demands a string for money fields. If the API ever
    // regresses to handing back a JSON number, validation must catch it
    // — that is the value-add the wrapper buys us.
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...validPortfolio,
      totalValue: 1700,
    });
    await expect(portfolioApi.get('id')).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it('rejects holding entry when quantity is a number instead of a decimal string', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...validPortfolio, holdings: [{ ...validHolding, quantity: 10 }] },
    ]);
    await expect(portfolioApi.list()).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it('delete() DELETEs /portfolios/:id and resolves on undefined', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(portfolioApi.delete('xyz')).resolves.toBeUndefined();
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/portfolios/xyz');
    expect((call[1] as RequestInit).method).toBe('DELETE');
  });
});
