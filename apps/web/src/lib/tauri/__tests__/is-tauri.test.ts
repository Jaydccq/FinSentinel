import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('isTauri', () => {
  beforeEach(() => vi.resetModules());

  it('returns false when no __TAURI_INTERNALS__ present', async () => {
    const origWindow = globalThis.window;
    globalThis.window = {} as any;
    const { isTauri } = await import('../is-tauri');
    expect(isTauri()).toBe(false);
    globalThis.window = origWindow;
  });

  it('returns true when __TAURI_INTERNALS__ is defined', async () => {
    const origWindow = globalThis.window;
    globalThis.window = { __TAURI_INTERNALS__: {} } as any;
    const { isTauri } = await import('../is-tauri');
    expect(isTauri()).toBe(true);
    globalThis.window = origWindow;
  });
});
