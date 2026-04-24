import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('local-login performLogin URL composition', () => {
  const original = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'tok-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME = 'local';
    process.env.NEXT_PUBLIC_LOCAL_USER_PASSWORD = 'localpass1';
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.resetModules();
    // Clear the localStorage cache so each test forces a real performLogin call.
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('fs_local_token');
    }
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it("hits '/api/auth/login' (relative) when no API base is set", async () => {
    const mod = await import('../local-login');
    mod.clearCachedToken();
    await mod.ensureLocalToken();
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('/api/auth/login');
  });

  it('hits a full origin under Tauri (env set), even when no apiBase argument is passed', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080';
    const mod = await import('../local-login');
    mod.clearCachedToken();
    await mod.ensureLocalToken();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('http://127.0.0.1:8080/api/auth/login');
  });

  it('explicit apiBase argument wins over the env-resolved one', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://wrong.example';
    const mod = await import('../local-login');
    mod.clearCachedToken();
    await mod.ensureLocalToken('http://override.example');
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('http://override.example/api/auth/login');
  });
});
