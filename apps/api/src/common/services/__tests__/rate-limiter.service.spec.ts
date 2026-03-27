import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { RateLimiterService } from '../rate-limiter.service';

// ── Mock Redis ────────────────────────────────────────────────────────────────
function createMockRedis() {
  return {
    eval: vi.fn(),
  };
}

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    mockRedis = createMockRedis();

    const module = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        {
          provide: 'REDIS',
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get(RateLimiterService);
  });

  // ── allows request when under limit ─────────────────────────────────────
  it('allows request when under limit', async () => {
    // Lua returns [allowed=1, remaining=59, ttl_ms=60000]
    mockRedis.eval.mockResolvedValue([1, 59, 60000]);

    const result = await service.check({
      dimension: 'user',
      identifier: 'alice',
      endpoint: 'GET:/api/risk',
      limit: 60,
      windowSecs: 60,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59);
    expect(result.retryAfterMs).toBe(60000);
  });

  // ── blocks request when over limit ──────────────────────────────────────
  it('blocks request when over limit', async () => {
    // Lua returns [allowed=0, remaining=0, ttl_ms=45000]
    mockRedis.eval.mockResolvedValue([0, 0, 45000]);

    const result = await service.check({
      dimension: 'user',
      identifier: 'alice',
      endpoint: 'GET:/api/risk',
      limit: 60,
      windowSecs: 60,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(45000);
  });

  // ── returns correct remaining count ─────────────────────────────────────
  it('returns correct remaining count', async () => {
    // 10th request out of 60 limit
    mockRedis.eval.mockResolvedValue([1, 50, 30000]);

    const result = await service.check({
      dimension: 'ip',
      identifier: '192.168.1.100',
      endpoint: 'POST:/api/auth/login',
      limit: 60,
      windowSecs: 60,
    });

    expect(result.remaining).toBe(50);
  });

  // ── sets TTL on first request ───────────────────────────────────────────
  it('sets TTL on first request (verifies Lua script args)', async () => {
    mockRedis.eval.mockResolvedValue([1, 59, 60000]);

    await service.check({
      dimension: 'user',
      identifier: 'bob',
      endpoint: 'GET:/api/portfolio',
      limit: 60,
      windowSecs: 60,
    });

    // Verify the eval call passes the correct key, args, etc.
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);

    const [script, keyCount, key, windowSecs, limit] =
      mockRedis.eval.mock.calls[0]!;

    expect(typeof script).toBe('string');
    expect(keyCount).toBe(1);
    expect(key).toBe('rl:user:bob:GET:/api/portfolio');
    expect(windowSecs).toBe(60);
    expect(limit).toBe(60);
  });

  // ── key format uses dimension:identifier:endpoint ───────────────────────
  it('constructs key as rl:{dimension}:{identifier}:{endpoint}', async () => {
    mockRedis.eval.mockResolvedValue([1, 9, 120000]);

    await service.check({
      dimension: 'ip',
      identifier: '10.0.0.1',
      endpoint: 'DELETE:/api/documents/42',
      limit: 10,
      windowSecs: 120,
    });

    const key = mockRedis.eval.mock.calls[0]![2];
    expect(key).toBe('rl:ip:10.0.0.1:DELETE:/api/documents/42');
  });
});
