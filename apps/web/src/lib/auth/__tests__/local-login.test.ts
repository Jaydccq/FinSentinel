import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('submitLogin URL composition', () => {
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
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.resetModules();
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
    mod.__resetForTests();
    await mod.submitLogin('local', 'localpass1');
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('/api/auth/login');
  });

  it('hits a full origin under Tauri (env set), even when no apiBase argument is passed', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080';
    const mod = await import('../local-login');
    mod.__resetForTests();
    await mod.submitLogin('local', 'localpass1');
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('http://127.0.0.1:8080/api/auth/login');
  });

  it('explicit apiBase argument wins over the env-resolved one', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://wrong.example';
    const mod = await import('../local-login');
    mod.__resetForTests();
    await mod.submitLogin('local', 'localpass1', 'http://override.example');
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('http://override.example/api/auth/login');
  });

  it('sends X-Client: desktop so the backend includes the token in the body', async () => {
    const mod = await import('../local-login');
    mod.__resetForTests();
    await mod.submitLogin('local', 'localpass1');
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Client']).toBe('desktop');
  });
});

describe('ensureLocalToken (browser, no auto-login)', () => {
  beforeEach(() => {
    vi.resetModules();
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  it('returns cached localStorage token in the browser', async () => {
    window.localStorage.setItem('fs_local_token', 'cached-browser');
    const mod = await import('../local-login');
    mod.__resetForTests();
    const token = await mod.ensureLocalToken();
    expect(token).toBe('cached-browser');
  });

  it('returns null when no token is cached (no env-based auto-login any more)', async () => {
    const mod = await import('../local-login');
    mod.__resetForTests();
    const token = await mod.ensureLocalToken();
    expect(token).toBeNull();
  });
});

describe('local-login Tauri keychain path', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let invokeSpy: ReturnType<typeof vi.fn>;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    globalThis.window = {
      ...originalWindow,
      __TAURI_INTERNALS__: {},
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
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@tauri-apps/api/core');
    globalThis.window = originalWindow;
  });

  it('reads the token from the keychain and does NOT fall back to auto-login', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_token') return 'kc-cached';
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    mod.__resetForTests();
    const token = await mod.ensureLocalToken('http://api.local');

    expect(token).toBe('kc-cached');
    expect(invokeSpy).toHaveBeenCalledWith('read_token');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('fs_local_token')).toBeNull();
  });

  it('submitLogin writes the fresh token to the keychain, not localStorage', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'write_token') return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    mod.__resetForTests();
    const token = await mod.submitLogin('local', 'localpass1', 'http://api.local');

    expect(token).toBe('kc-fresh');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(invokeSpy).toHaveBeenCalledWith('write_token', { token: 'kc-fresh' });
    expect(window.localStorage.getItem('fs_local_token')).toBeNull();
  });

  it('returns null under Tauri when the keychain is empty (caller shows login UI)', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_token') return null;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    mod.__resetForTests();
    const token = await mod.ensureLocalToken('http://api.local');

    expect(token).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clearCachedToken under Tauri invokes clear_token', async () => {
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_token') return 'kc-cached';
      if (cmd === 'clear_token') return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    mod.__resetForTests();
    await mod.ensureLocalToken('http://api.local');
    mod.clearCachedToken();

    await new Promise((r) => setTimeout(r, 0));
    expect(invokeSpy).toHaveBeenCalledWith('clear_token');
  });

  it('F-3 shim: migrates legacy localStorage token into the keychain on first boot', async () => {
    window.localStorage.setItem('fs_local_token', 'legacy-token-abc');
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'write_token') return undefined;
      if (cmd === 'read_token') return null;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const mod = await import('../local-login');
    mod.__resetForTests();
    const token = await mod.ensureLocalToken('http://api.local');

    expect(token).toBe('legacy-token-abc');
    // Migrated forward: keychain got it, localStorage was cleared.
    expect(invokeSpy).toHaveBeenCalledWith('write_token', { token: 'legacy-token-abc' });
    expect(window.localStorage.getItem('fs_local_token')).toBeNull();
    // Shim only fires once per page load.
    expect(invokeSpy).not.toHaveBeenCalledWith('read_token');
  });
});
