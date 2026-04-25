import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '../jwt.service';
import { jwtConfig } from '../../config/jwt.config';
import { RefreshService } from '../refresh.service';
import type { AuthRuntimeConfig } from '../../config/auth.config';

// In-memory Redis mock — only the methods RefreshService actually uses.
function createMockRedis() {
  const store = new Map<string, string>();
  return {
    _store: store,
    set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
  };
}

const TEST_JWT_CONFIG = {
  secret: 'a'.repeat(32),
  expiration: 86_400_000,
  issuer: 'finsentinel-api-test',
  audience: 'finsentinel-web-test',
  refreshAudience: 'finsentinel-refresh',
};

const TEST_AUTH_CONFIG: AuthRuntimeConfig = {
  cookie: { name: 'FS_AUTH', secure: false, sameSite: 'lax', maxAgeMs: 86_400_000 },
  corsOrigins: ['http://localhost:3000'],
  refreshTokensEnabled: true,
  jtiRevocationEnabled: false,
  accessTokenTtlMsWhenRefreshOn: 15 * 60 * 1000,
  refreshTokenTtlMs: 60 * 1000, // shorter for tests
};

describe('RefreshService', () => {
  let refreshService: RefreshService;
  let jwtService: JwtService;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    mockRedis = createMockRedis();
    const module = await Test.createTestingModule({
      providers: [
        RefreshService,
        JwtService,
        { provide: jwtConfig.KEY, useValue: TEST_JWT_CONFIG },
        { provide: 'REDIS', useValue: mockRedis },
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string): T | undefined =>
              key === 'auth' ? (TEST_AUTH_CONFIG as unknown as T) : undefined,
          },
        },
      ],
    }).compile();
    refreshService = module.get(RefreshService);
    jwtService = module.get(JwtService);
  });

  it('issueNewFamily writes a refresh:family:* key with the new jti', async () => {
    const issued = await refreshService.issueNewFamily(
      'alice',
      '00000000-0000-4000-8000-000000000001',
    );
    const key = `refresh:family:00000000-0000-4000-8000-000000000001:${issued.familyId}`;
    expect(mockRedis._store.get(key)).toBe(issued.jti);
  });

  it('rotate succeeds when payload.jti matches the stored value, replaces stored jti', async () => {
    const initial = await refreshService.issueNewFamily(
      'alice',
      '00000000-0000-4000-8000-000000000001',
    );
    const key = `refresh:family:00000000-0000-4000-8000-000000000001:${initial.familyId}`;
    expect(mockRedis._store.get(key)).toBe(initial.jti);

    const rotated = await refreshService.rotate(initial.token);
    expect(rotated).not.toBeNull();
    expect(rotated!.jti).not.toBe(initial.jti);
    expect(rotated!.familyId).toBe(initial.familyId);
    // Family pointer now reflects the NEW jti.
    expect(mockRedis._store.get(key)).toBe(rotated!.jti);
  });

  it('rotate detects reuse of an OLD refresh: DELs the family and returns null', async () => {
    const initial = await refreshService.issueNewFamily(
      'alice',
      '00000000-0000-4000-8000-000000000001',
    );
    const key = `refresh:family:00000000-0000-4000-8000-000000000001:${initial.familyId}`;

    // Legit holder rotates once.
    const rotated = await refreshService.rotate(initial.token);
    expect(rotated).not.toBeNull();
    expect(mockRedis._store.get(key)).toBe(rotated!.jti);

    // Attacker presents the OLD initial.token AGAIN — that jti no longer
    // matches the stored value → reuse detected.
    const result = await refreshService.rotate(initial.token);
    expect(result).toBeNull();
    expect(mockRedis._store.get(key)).toBeUndefined();
    expect(mockRedis.del).toHaveBeenCalled();
  });

  it('rotate rejects an expired refresh token', async () => {
    // Mint a refresh token that expires in -1 sec by patching the config
    // briefly. Easiest: hand-roll via JwtService with explicit expiry in the past.
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(TEST_JWT_CONFIG.secret);
    const expired = await new SignJWT({
      uid: '00000000-0000-4000-8000-000000000001',
      fid: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('alice')
      .setIssuer(TEST_JWT_CONFIG.issuer)
      .setAudience(TEST_JWT_CONFIG.refreshAudience)
      .setJti('11111111-1111-4111-8111-111111111111')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(secret);

    const result = await refreshService.rotate(expired);
    expect(result).toBeNull();
  });

  it('rotate rejects when the family key is missing entirely (post-logout / TTL expiry)', async () => {
    const initial = await refreshService.issueNewFamily(
      'alice',
      '00000000-0000-4000-8000-000000000001',
    );
    // Simulate logout / TTL expiry by clearing the store.
    mockRedis._store.clear();

    const result = await refreshService.rotate(initial.token);
    expect(result).toBeNull();
  });

  it('invalidateFamily removes the family key', async () => {
    const initial = await refreshService.issueNewFamily(
      'alice',
      '00000000-0000-4000-8000-000000000001',
    );
    await refreshService.invalidateFamily(
      '00000000-0000-4000-8000-000000000001',
      initial.familyId,
    );
    const key = `refresh:family:00000000-0000-4000-8000-000000000001:${initial.familyId}`;
    expect(mockRedis._store.get(key)).toBeUndefined();
  });

  it('an access-audience token cannot be replayed against rotate (refresh audience mismatch)', async () => {
    // Mint an access token (different audience).
    const access = await jwtService.generateAccessToken(
      'alice',
      '00000000-0000-4000-8000-000000000001',
      60_000,
    );
    const result = await refreshService.rotate(access.token);
    expect(result).toBeNull();
  });
});
