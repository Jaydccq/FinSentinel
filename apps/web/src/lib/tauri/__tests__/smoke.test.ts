import { describe, it, expect, vi, afterEach } from 'vitest';

function asTestWindow(value: Record<string, unknown>): Window & typeof globalThis {
  return value as unknown as Window & typeof globalThis;
}

describe('pingDesktop', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.doUnmock('@tauri-apps/api/core');
    globalThis.window = originalWindow;
    vi.resetModules();
  });

  it('returns null outside Tauri', async () => {
    globalThis.window = asTestWindow({});
    vi.resetModules();
    const { pingDesktop } = await import('../smoke');
    await expect(pingDesktop()).resolves.toBeNull();
  });

  it('invokes ping and returns pong under Tauri', async () => {
    globalThis.window = asTestWindow({ __TAURI_INTERNALS__: {} });
    const invokeSpy = vi.fn().mockResolvedValue('pong');
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeSpy }));
    vi.resetModules();

    const { pingDesktop } = await import('../smoke');
    await expect(pingDesktop()).resolves.toBe('pong');
    expect(invokeSpy).toHaveBeenCalledWith('ping');
  });
});
