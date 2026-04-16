import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getApiBaseUrl } from '../api-base-url';

describe('getApiBaseUrl', () => {
  const originalEnv = { ...process.env };
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.window = originalWindow;
  });

  it('returns NEXT_PUBLIC_API_BASE_URL when set (Tauri build)', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.finsentinel.example';
    expect(getApiBaseUrl()).toBe('https://api.finsentinel.example');
  });

  it('returns empty string (relative) when env var absent (browser default)', () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(getApiBaseUrl()).toBe('');
  });

  it('strips trailing slash', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.com/';
    expect(getApiBaseUrl()).toBe('https://api.example.com');
  });
});
