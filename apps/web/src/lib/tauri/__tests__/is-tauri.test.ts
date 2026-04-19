import { describe, it, expect, vi, beforeEach } from 'vitest';

function asTestWindow(value: Record<string, unknown>): Window & typeof globalThis {
  return value as unknown as Window & typeof globalThis;
}

describe('isTauri', () => {
  beforeEach(() => vi.resetModules());

  it('returns false when no __TAURI_INTERNALS__ present', async () => {
    const origWindow = globalThis.window;
    globalThis.window = asTestWindow({});
    const { isTauri } = await import('../is-tauri');
    expect(isTauri()).toBe(false);
    globalThis.window = origWindow;
  });

  it('returns true when __TAURI_INTERNALS__ is defined', async () => {
    const origWindow = globalThis.window;
    globalThis.window = asTestWindow({ __TAURI_INTERNALS__: {} });
    const { isTauri } = await import('../is-tauri');
    expect(isTauri()).toBe(true);
    globalThis.window = origWindow;
  });
});
