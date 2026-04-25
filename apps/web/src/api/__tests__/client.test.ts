import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError, resolveBase } from '../client';

describe('resolveBase', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("returns '/api' (relative) when NEXT_PUBLIC_API_BASE_URL is unset (browser default)", () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(resolveBase()).toBe('/api');
  });

  it('prepends a full origin when NEXT_PUBLIC_API_BASE_URL is set (Tauri build)', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080';
    expect(resolveBase()).toBe('http://127.0.0.1:8080/api');
  });

  it('strips a trailing slash before joining', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080/';
    expect(resolveBase()).toBe('http://127.0.0.1:8080/api');
  });
});

describe('apiFetch URL composition', () => {
  const original = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pong: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const localLogin = await import('../../lib/auth/local-login');
    vi.spyOn(localLogin, 'ensureLocalToken').mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hits '/api<path>' under browser (no env override)", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    await apiFetch('/health');
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('/api/health');
  });

  it('hits the full origin under Tauri build (env set)', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080';
    await apiFetch('/health');
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('http://127.0.0.1:8080/api/health');
  });
});

describe('apiFetch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws a short ApiError when backend returns HTML (unreachable rewrite target)', async () => {
    // Simulates what happens when NestJS at localhost:3001 is down and
    // Next.js rewrite proxy returns its own 404 HTML page.
    const htmlBody = '<!DOCTYPE html><html><head><title>404</title></head><body>...</body></html>';
    globalThis.fetch = vi.fn().mockImplementation(
      async () =>
        new Response(htmlBody, {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    );

    const err = await apiFetch('/portfolios').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).not.toContain('<!DOCTYPE');
    expect((err as ApiError).message).toMatch(/backend unreachable|http 404/i);
  });

  it('preserves JSON error.message from backend responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Portfolio not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiFetch('/portfolios/missing')).rejects.toThrow('Portfolio not found');
  });

  it('returns parsed JSON on 2xx', async () => {
    const payload = { portfolios: [{ id: '1' }] };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiFetch('/portfolios')).resolves.toEqual(payload);
  });

  it('returns undefined on 204 No Content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch('/portfolios/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

// ── Item 2 M3: silent-refresh on 401 ─────────────────────────────────────
describe('apiFetch silent refresh on 401', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('on 401 → calls /auth/refresh exactly once, then retries original request', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url: u, method });
      if (u.endsWith('/auth/refresh') && method === 'POST') {
        return new Response(null, { status: 204 });
      }
      // First original call → 401, second → 200.
      const originalCalls = calls.filter((c) => c.url.endsWith('/portfolios')).length;
      if (originalCalls === 1) {
        return new Response(JSON.stringify({ message: 'expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await expect(apiFetch('/portfolios')).resolves.toEqual({ ok: true });

    const refreshCalls = calls.filter((c) => c.url.endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    const portfolioCalls = calls.filter((c) => c.url.endsWith('/portfolios'));
    expect(portfolioCalls).toHaveLength(2);
  });

  it('on 401 + refresh fails → does NOT loop, surfaces final 401 to caller', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url: u, method });
      if (u.endsWith('/auth/refresh')) {
        return new Response(null, { status: 401 });
      }
      return new Response(JSON.stringify({ message: 'expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const err = await apiFetch('/portfolios').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);

    // Refresh attempted exactly once. Original called twice (initial + retry).
    const refreshCalls = calls.filter((c) => c.url.endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});
