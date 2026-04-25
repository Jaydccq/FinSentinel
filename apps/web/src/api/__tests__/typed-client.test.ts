import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { typedFetch, ResponseValidationError } from '../typed-client';

vi.mock('../../lib/auth/local-login', () => ({
  ensureLocalToken: vi.fn().mockResolvedValue(null),
  getCachedToken: () => null,
  clearCachedToken: () => {},
}));

describe('typedFetch', () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses response against the response schema', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'a', name: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await typedFetch({
      path: '/thing',
      method: 'GET',
      responseSchema: z.object({ id: z.string(), name: z.string() }),
    });
    expect(result).toEqual({ id: 'a', name: 'x' });
  });

  it('throws ResponseValidationError when response shape drifts', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, name: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(
      typedFetch({
        path: '/thing',
        method: 'GET',
        responseSchema: z.object({ id: z.string(), name: z.string() }),
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it('serializes request body and validates it when requestSchema is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await typedFetch({
      path: '/thing',
      method: 'POST',
      requestSchema: z.object({ qty: z.number().int() }),
      responseSchema: z.object({ ok: z.boolean() }),
      body: { qty: 3 },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ qty: 3 }));
  });
});
