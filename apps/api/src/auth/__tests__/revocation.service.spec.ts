import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { RevocationService } from '../revocation.service';

function createMockRedis() {
  const store = new Map<string, string>();
  const expiries = new Map<string, number>();
  return {
    _store: store,
    _expiries: expiries,
    set: vi.fn(async (key: string, value: string, ...rest: unknown[]) => {
      store.set(key, value);
      // Mirror the EX <secs> form used by RevocationService.
      for (let i = 0; i < rest.length - 1; i++) {
        const flag = rest[i];
        if (typeof flag === 'string' && flag.toUpperCase() === 'EX') {
          const secs = Number(rest[i + 1]);
          if (Number.isFinite(secs)) {
            expiries.set(key, Date.now() + secs * 1000);
          }
        }
      }
      return 'OK';
    }),
    exists: vi.fn(async (key: string) => {
      const exp = expiries.get(key);
      if (exp && Date.now() > exp) {
        store.delete(key);
        expiries.delete(key);
        return 0;
      }
      return store.has(key) ? 1 : 0;
    }),
  };
}

describe('RevocationService', () => {
  let service: RevocationService;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    mockRedis = createMockRedis();
    const module = await Test.createTestingModule({
      providers: [
        RevocationService,
        { provide: 'REDIS', useValue: mockRedis },
      ],
    }).compile();
    service = module.get(RevocationService);
  });

  it('revoke writes revoked_jti:<jti> with the supplied EX TTL', async () => {
    await service.revoke('11111111-1111-4111-8111-111111111111', 60);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'revoked_jti:11111111-1111-4111-8111-111111111111',
      '1',
      'EX',
      60,
    );
    expect(mockRedis._store.get('revoked_jti:11111111-1111-4111-8111-111111111111')).toBe('1');
  });

  it('isRevoked returns true after revoke for a fresh jti', async () => {
    await service.revoke('22222222-2222-4222-8222-222222222222', 30);
    await expect(
      service.isRevoked('22222222-2222-4222-8222-222222222222'),
    ).resolves.toBe(true);
  });

  it('isRevoked returns false for an unknown jti', async () => {
    await expect(
      service.isRevoked('99999999-9999-4999-8999-999999999999'),
    ).resolves.toBe(false);
  });

  it('revoke is a no-op when ttlSeconds <= 0 (token already expired)', async () => {
    await service.revoke('33333333-3333-4333-8333-333333333333', 0);
    expect(mockRedis.set).not.toHaveBeenCalled();
    await expect(
      service.isRevoked('33333333-3333-4333-8333-333333333333'),
    ).resolves.toBe(false);
  });
});
