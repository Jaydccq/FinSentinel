import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { LoginProtectionService } from '../login-protection.service';

/**
 * In-memory Redis stand-in covering only the commands LoginProtectionService
 * uses (incr, expire, exists, set, del). Mirrors the surface ioredis exposes
 * so the service is exercised through its real public methods.
 */
function createMockRedis() {
  const store = new Map<string, string>();
  const expiries = new Map<string, number>();

  return {
    incr: vi.fn(async (key: string) => {
      const next = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async (key: string, secs: number) => {
      if (!store.has(key)) return 0;
      expiries.set(key, Date.now() + secs * 1000);
      return 1;
    }),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    set: vi.fn(async (key: string, value: string, _mode: string, _secs: number) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      expiries.delete(key);
      return had ? 1 : 0;
    }),
    _store: store,
    _expiries: expiries,
  };
}

describe('LoginProtectionService', () => {
  let service: LoginProtectionService;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    mockRedis = createMockRedis();

    const module = await Test.createTestingModule({
      providers: [
        LoginProtectionService,
        { provide: 'REDIS', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(LoginProtectionService);
  });

  describe('recordFailure', () => {
    it('INCRs the per-(username, ip) counter and sets a 15-min TTL on first failure', async () => {
      const result = await service.recordFailure('alice', '1.2.3.4');

      expect(result.fails).toBe(1);
      expect(result.lockedUntil).toBeUndefined();
      expect(mockRedis.incr).toHaveBeenCalledWith('login:fails:alice:1.2.3.4');
      expect(mockRedis.expire).toHaveBeenCalledWith('login:fails:alice:1.2.3.4', 15 * 60);
    });

    it('does NOT call expire on subsequent increments', async () => {
      await service.recordFailure('alice', '1.2.3.4');
      mockRedis.expire.mockClear();
      const result = await service.recordFailure('alice', '1.2.3.4');

      expect(result.fails).toBe(2);
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('triggers a hard lockout at the 10th consecutive failure', async () => {
      let result;
      for (let i = 1; i <= 10; i++) {
        result = await service.recordFailure('alice', '1.2.3.4');
      }
      expect(result!.fails).toBe(10);
      expect(result!.lockedUntil).toBeGreaterThan(Date.now());
      expect(mockRedis.set).toHaveBeenCalledWith(
        'login:lock:alice:1.2.3.4',
        '1',
        'EX',
        15 * 60,
      );
    });

    it('keeps the lock fresh on every additional failure past the threshold', async () => {
      for (let i = 1; i <= 12; i++) {
        await service.recordFailure('alice', '1.2.3.4');
      }
      // Set called for fail 10, 11, 12 — three lock writes total.
      expect(mockRedis.set).toHaveBeenCalledTimes(3);
    });

    it('isolates counters by (username, ip)', async () => {
      await service.recordFailure('alice', '1.2.3.4');
      await service.recordFailure('alice', '5.6.7.8');
      await service.recordFailure('bob', '1.2.3.4');

      expect(mockRedis._store.get('login:fails:alice:1.2.3.4')).toBe('1');
      expect(mockRedis._store.get('login:fails:alice:5.6.7.8')).toBe('1');
      expect(mockRedis._store.get('login:fails:bob:1.2.3.4')).toBe('1');
    });
  });

  describe('checkLocked', () => {
    it('returns false when no lock exists', async () => {
      await expect(service.checkLocked('alice', '1.2.3.4')).resolves.toBe(false);
    });

    it('returns true when the lock key exists', async () => {
      // Trigger a real lockout
      for (let i = 0; i < 10; i++) {
        await service.recordFailure('alice', '1.2.3.4');
      }
      await expect(service.checkLocked('alice', '1.2.3.4')).resolves.toBe(true);
    });
  });

  describe('resetOnSuccess', () => {
    it('deletes both fail and lock keys for the (username, ip) pair', async () => {
      for (let i = 0; i < 10; i++) {
        await service.recordFailure('alice', '1.2.3.4');
      }
      await service.resetOnSuccess('alice', '1.2.3.4');

      expect(mockRedis._store.has('login:fails:alice:1.2.3.4')).toBe(false);
      expect(mockRedis._store.has('login:lock:alice:1.2.3.4')).toBe(false);
      await expect(service.checkLocked('alice', '1.2.3.4')).resolves.toBe(false);
    });

    it('is idempotent when no keys exist', async () => {
      await expect(service.resetOnSuccess('ghost', '0.0.0.0')).resolves.toBeUndefined();
    });
  });

  describe('computeDelayMs', () => {
    it.each([
      [0, 0],
      [1, 200], // 100 * 2^1
      [2, 400], // 100 * 2^2
      [3, 800], // 100 * 2^3
      [4, 1600], // 100 * 2^4
      [5, 3200], // 100 * 2^5
      [6, 5000], // 100 * 2^6 = 6400 → capped at 5000
      [7, 5000], // capped
      [20, 5000], // capped
    ])('fails=%i → delayMs=%i', (fails, expected) => {
      expect(service.computeDelayMs(fails)).toBe(expected);
    });

    it('never exceeds the 5s cap', () => {
      for (let i = 1; i <= 50; i++) {
        expect(service.computeDelayMs(i)).toBeLessThanOrEqual(5000);
      }
    });
  });
});
