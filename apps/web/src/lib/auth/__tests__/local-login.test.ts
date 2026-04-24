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

describe('local-login Tauri keychain path', () => {
  const original = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;
  let invokeSpy: ReturnType<typeof vi.fn>;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Stub the Tauri runtime sentinel that `isTauri()` keys off of.
    globalThis.window = {
      ...originalWindow,
      __TAURI_INTERNALS__: {},
      // Keep a real localStorage so we can assert it stays untouched.
      localStorage: originalWindow.localStorage,
    } as unknown as Window & typeof globalThis;
    window.localStorage.clear();

    invokeSpy = vi.fn();
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeSpy }));

    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'kc-fresh' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME = 'local';
    process.env.NEXT_PUBLIC_LOCAL_USER_PASSWORD = 'localpass1';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
    vi.doUnmock('@tauri-apps/api/core');
    globalThis.window = originalWindow;
  });

  it('reads the token from the keychain before falling back to performLogin', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_token') return 'kc-cached';
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    const token = await mod.ensureLocalToken('http://api.local');

    expect(token).toBe('kc-cached');
    expect(invokeSpy).toHaveBeenCalledWith('read_token');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('fs_local_token')).toBeNull();
  });

  it('writes the fresh token to the keychain after performLogin, not localStorage', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_token') return null;
      if (cmd === 'write_token') return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    const token = await mod.ensureLocalToken('http://api.local');

    expect(token).toBe('kc-fresh');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(invokeSpy).toHaveBeenCalledWith('write_token', { token: 'kc-fresh' });
    expect(window.localStorage.getItem('fs_local_token')).toBeNull();
  });

  it('session-only keychain (Linux without Secret Service) falls back to in-memory token', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_token') throw { error: 'session_only' };
      if (cmd === 'write_token') throw { error: 'session_only' };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    const token = await mod.ensureLocalToken('http://api.local');

    // Login still succeeds — the token lives in memory via performLogin.
    expect(token).toBe('kc-fresh');
    expect(mod.getCachedToken()).toBe('kc-fresh');
    expect(window.localStorage.getItem('fs_local_token')).toBeNull();
  });

  it('clearCachedToken under Tauri invokes clear_token and leaves localStorage alone', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_token') return 'kc-cached';
      if (cmd === 'clear_token') return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    window.localStorage.setItem('fs_local_token', 'stale-browser-token');

    const mod = await import('../local-login');
    await mod.ensureLocalToken('http://api.local');
    mod.clearCachedToken();

    // Flush microtasks for the fire-and-forget clear_token invoke — it goes
    // through a dynamic import boundary, so multiple ticks are needed.
    await new Promise((r) => setTimeout(r, 0));
    expect(invokeSpy).toHaveBeenCalledWith('clear_token');
    // F-1 does NOT remove legacy localStorage — that's F-3's shim.
    expect(window.localStorage.getItem('fs_local_token')).toBe('stale-browser-token');
  });
});
