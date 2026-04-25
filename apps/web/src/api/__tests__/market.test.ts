import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApiFetch = vi.fn();

vi.mock('../client', () => ({
  apiFetch: mockApiFetch,
}));

const { marketApi } = await import('../market');

describe('marketApi', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('normalizes string-based quote payloads into numbers', async () => {
    mockApiFetch.mockResolvedValueOnce({
      AAPL: {
        ticker: 'AAPL',
        open: '148.00',
        high: '155.00',
        low: '147.50',
        close: '153.50',
        volume: 50000000,
        timestamp: 1700245600000,
      },
    });

    const result = await marketApi.batchQuotes(['AAPL']);

    expect(result.AAPL).toEqual({
      ticker: 'AAPL',
      open: 148,
      high: 155,
      low: 147.5,
      close: 153.5,
      volume: 50000000,
      timestamp: 1700245600000,
    });
  });

  it('normalizes string-based history bars into chart-friendly numbers', async () => {
    mockApiFetch.mockResolvedValueOnce([
      {
        open: '150.00',
        high: '155.00',
        low: '149.00',
        close: '153.50',
        volume: 50000000,
        timestamp: 1700000000000,
      },
    ]);

    const result = await marketApi.history('AAPL', 30);

    expect(result).toEqual([
      {
        o: 150,
        h: 155,
        l: 149,
        c: 153.5,
        v: 50000000,
        t: 1700000000000,
      },
    ]);
  });
});
