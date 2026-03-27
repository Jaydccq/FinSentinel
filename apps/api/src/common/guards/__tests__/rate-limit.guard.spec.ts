import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from '../rate-limit.guard';
import { RateLimiterService } from '../../services/rate-limiter.service';
import { RATE_LIMIT_KEY } from '../../decorators/rate-limit.decorator';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockExecutionContext(overrides: {
  user?: { userId: string; username: string };
  ip?: string;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
}): ExecutionContext {
  const request = {
    user: overrides.user,
    ip: overrides.ip ?? '127.0.0.1',
    headers: overrides.headers ?? {},
    method: overrides.method ?? 'GET',
    route: { path: overrides.path ?? '/api/test' },
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: vi.fn(),
      }),
    }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let reflector: Reflector;
  let rateLimiter: RateLimiterService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        {
          provide: Reflector,
          useValue: {
            get: vi.fn(),
          },
        },
        {
          provide: RateLimiterService,
          useValue: {
            check: vi.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(RateLimitGuard);
    reflector = module.get(Reflector);
    rateLimiter = module.get(RateLimiterService);
  });

  // ── passes when no @RateLimit decorator ─────────────────────────────────
  it('passes when no @RateLimit decorator', async () => {
    vi.mocked(reflector.get).mockReturnValue(undefined);

    const ctx = createMockExecutionContext({});
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(rateLimiter.check).not.toHaveBeenCalled();
  });

  // ── passes when under limit ─────────────────────────────────────────────
  it('passes when under limit', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 60,
      windowSecs: 60,
      key: '',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfterMs: 60000,
    });

    const ctx = createMockExecutionContext({
      user: { userId: 'u1', username: 'alice' },
      method: 'GET',
      path: '/api/risk',
    });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
  });

  // ── throws 429 when over limit ──────────────────────────────────────────
  it('throws 429 when over limit', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 5,
      windowSecs: 60,
      key: '',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 45000,
    });

    const ctx = createMockExecutionContext({
      user: { userId: 'u1', username: 'alice' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const response = httpErr.getResponse() as Record<string, unknown>;
      expect(response['retryAfterMs']).toBe(45000);
    }
  });

  // ── uses username for authenticated requests ────────────────────────────
  it('uses username for authenticated requests', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 60,
      windowSecs: 60,
      key: '',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfterMs: 60000,
    });

    const ctx = createMockExecutionContext({
      user: { userId: 'u1', username: 'alice' },
      method: 'GET',
      path: '/api/risk',
    });
    await guard.canActivate(ctx);

    expect(rateLimiter.check).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'user',
        identifier: 'alice',
      }),
    );
  });

  // ── uses IP for unauthenticated requests ────────────────────────────────
  it('uses IP for unauthenticated requests', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 60,
      windowSecs: 60,
      key: '',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfterMs: 60000,
    });

    const ctx = createMockExecutionContext({
      ip: '203.0.113.50',
      method: 'POST',
      path: '/api/auth/login',
    });
    await guard.canActivate(ctx);

    expect(rateLimiter.check).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'ip',
        identifier: '203.0.113.50',
      }),
    );
  });

  // ── uses X-Forwarded-For from trusted proxy ─────────────────────────────
  it('uses X-Forwarded-For IP when behind trusted proxy', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 60,
      windowSecs: 60,
      key: '',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfterMs: 60000,
    });

    const ctx = createMockExecutionContext({
      ip: '127.0.0.1', // trusted proxy
      headers: { 'x-forwarded-for': '8.8.8.8, 127.0.0.1' },
      method: 'GET',
      path: '/api/data',
    });
    await guard.canActivate(ctx);

    expect(rateLimiter.check).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: '8.8.8.8',
      }),
    );
  });

  // ── does NOT use X-Forwarded-For from untrusted proxy ───────────────────
  it('ignores X-Forwarded-For from untrusted proxy', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 60,
      windowSecs: 60,
      key: '',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: true,
      remaining: 59,
      retryAfterMs: 60000,
    });

    const ctx = createMockExecutionContext({
      ip: '203.0.113.50', // NOT a trusted proxy
      headers: { 'x-forwarded-for': '8.8.8.8, 203.0.113.50' },
      method: 'GET',
      path: '/api/data',
    });
    await guard.canActivate(ctx);

    expect(rateLimiter.check).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: '203.0.113.50',
      }),
    );
  });

  // ── uses custom key when provided ───────────────────────────────────────
  it('uses custom key override when provided', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 10,
      windowSecs: 3600,
      key: 'custom:expensive-op',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfterMs: 3600000,
    });

    const ctx = createMockExecutionContext({
      user: { userId: 'u1', username: 'alice' },
      method: 'POST',
      path: '/api/analysis',
    });
    await guard.canActivate(ctx);

    expect(rateLimiter.check).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'custom:expensive-op',
      }),
    );
  });

  // ── sets Retry-After header on 429 ──────────────────────────────────────
  it('sets Retry-After header on 429 response', async () => {
    vi.mocked(reflector.get).mockReturnValue({
      limit: 1,
      windowSecs: 60,
      key: '',
    });
    vi.mocked(rateLimiter.check).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 30000,
    });

    const ctx = createMockExecutionContext({
      ip: '1.2.3.4',
    });

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const response = httpErr.getResponse() as Record<string, unknown>;
      // Retry-After in seconds (HTTP standard)
      expect(response['retryAfterSecs']).toBe(30);
    }
  });
});
