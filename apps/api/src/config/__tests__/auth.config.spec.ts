import { describe, it, expect } from 'vitest';
import { authConfigFactory } from '../auth.config';

describe('authConfigFactory', () => {
  const baseEnv = {
    AUTH_COOKIE_NAME: 'FS_AUTH',
    AUTH_COOKIE_SECURE: 'false',
    AUTH_COOKIE_SAMESITE: 'lax',
    AUTH_COOKIE_MAX_AGE_SEC: '86400',
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
  };

  it('parses env into typed cookie + cors config', () => {
    const cfg = authConfigFactory(baseEnv);
    expect(cfg.cookie.name).toBe('FS_AUTH');
    expect(cfg.cookie.secure).toBe(false);
    expect(cfg.cookie.sameSite).toBe('lax');
    expect(cfg.cookie.maxAgeMs).toBe(86400 * 1000);
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });

  it('honours secure=true and sameSite=strict', () => {
    const cfg = authConfigFactory({
      ...baseEnv,
      AUTH_COOKIE_SECURE: 'true',
      AUTH_COOKIE_SAMESITE: 'strict',
    });
    expect(cfg.cookie.secure).toBe(true);
    expect(cfg.cookie.sameSite).toBe('strict');
  });

  it('falls back to safe defaults when env keys are absent', () => {
    const cfg = authConfigFactory({});
    expect(cfg.cookie.name).toBe('FS_AUTH');
    expect(cfg.cookie.secure).toBe(false); // dev default
    expect(cfg.cookie.sameSite).toBe('lax');
    expect(cfg.cookie.maxAgeMs).toBe(86400 * 1000);
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });

  it('rejects an invalid sameSite value', () => {
    expect(() => authConfigFactory({ ...baseEnv, AUTH_COOKIE_SAMESITE: 'bogus' })).toThrow();
  });

  it('passes through optional cookie domain', () => {
    const cfg = authConfigFactory({
      ...baseEnv,
      AUTH_COOKIE_DOMAIN: 'finsentinel.example',
    });
    expect(cfg.cookie.domain).toBe('finsentinel.example');
  });
});
