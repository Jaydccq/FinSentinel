/**
 * Unit + lightweight integration coverage for JwtGuard.
 *
 * Why this exists: AuthController writes the cookie under the env-driven
 * `auth.cookie.name`, but JwtGuard previously hardcoded 'FS_AUTH' on the
 * read side. If an operator changed AUTH_COOKIE_NAME, login succeeded
 * but every subsequent request hit 401. This file pins the configurable
 * read path so the regression cannot recur.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Controller, Get, UseGuards, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { JwtGuard } from '../jwt.guard';
import { JwtService } from '../jwt.service';
import { RevocationService } from '../revocation.service';
import type { AuthRuntimeConfig } from '../../config/auth.config';

const VALID_TOKEN = 'valid.jwt.token';
const VALID_PAYLOAD = {
  username: 'alice',
  userId: 'u-1',
  jti: '11111111-1111-4111-8111-111111111111',
};

const stubJwtService = {
  validateToken: async (token: string) => (token === VALID_TOKEN ? VALID_PAYLOAD : null),
} as unknown as JwtService;

const noopRevocationService = {
  isRevoked: vi.fn(async () => false),
  revoke: vi.fn(async () => undefined),
} as unknown as RevocationService;

function makeAuthConfig(
  name = 'FS_AUTH',
  flagOverrides: Partial<
    Pick<
      AuthRuntimeConfig,
      | 'refreshTokensEnabled'
      | 'jtiRevocationEnabled'
      | 'accessTokenTtlMsWhenRefreshOn'
      | 'refreshTokenTtlMs'
    >
  > = {},
): AuthRuntimeConfig {
  return {
    cookie: { name, secure: false, sameSite: 'lax', maxAgeMs: 86_400_000 },
    corsOrigins: ['http://localhost:3000'],
    refreshTokensEnabled: false,
    jtiRevocationEnabled: false,
    accessTokenTtlMsWhenRefreshOn: 15 * 60 * 1000,
    refreshTokenTtlMs: 7 * 24 * 60 * 60 * 1000,
    ...flagOverrides,
  };
}

function configServiceFor(authConfig: AuthRuntimeConfig): ConfigService {
  return {
    get: <T>(key: string): T | undefined =>
      key === 'auth' ? (authConfig as unknown as T) : undefined,
  } as ConfigService;
}

function makeContext(
  req: Partial<{
    headers: Record<string, string>;
    cookies: Record<string, string>;
  }>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: req.headers ?? {},
        cookies: req.cookies ?? {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtGuard.canActivate (unit)', () => {
  let guard: JwtGuard;

  beforeEach(() => {
    guard = new JwtGuard(stubJwtService, configServiceFor(makeAuthConfig()), noopRevocationService);
  });

  it('accepts Authorization: Bearer header', async () => {
    const ctx = makeContext({
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('accepts the default FS_AUTH cookie when no header is present', async () => {
    const ctx = makeContext({ cookies: { FS_AUTH: VALID_TOKEN } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('reads the cookie name from typed auth config — custom name accepted', async () => {
    const customGuard = new JwtGuard(
      stubJwtService,
      configServiceFor(makeAuthConfig('CUSTOM_AUTH')),
      noopRevocationService,
    );
    const ctx = makeContext({ cookies: { CUSTOM_AUTH: VALID_TOKEN } });
    await expect(customGuard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects when the cookie carries the legacy name but config says custom', async () => {
    const customGuard = new JwtGuard(
      stubJwtService,
      configServiceFor(makeAuthConfig('CUSTOM_AUTH')),
      noopRevocationService,
    );
    const ctx = makeContext({ cookies: { FS_AUTH: VALID_TOKEN } });
    await expect(customGuard.canActivate(ctx)).rejects.toThrow();
  });

  it('rejects when no header and no cookie are present', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow();
  });

  it('rejects when token is present but invalid', async () => {
    const ctx = makeContext({ cookies: { FS_AUTH: 'garbage' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow();
  });

  it('falls back to FS_AUTH if config returns undefined', async () => {
    const looseGuard = new JwtGuard(
      stubJwtService,
      {
        get: () => undefined,
      } as unknown as ConfigService,
      noopRevocationService,
    );
    const ctx = makeContext({ cookies: { FS_AUTH: VALID_TOKEN } });
    await expect(looseGuard.canActivate(ctx)).resolves.toBe(true);
  });

  // ── M4: jti revocation gate ─────────────────────────────────────────
  it('flag OFF (default): does NOT consult revocation service even if a jti exists', async () => {
    const isRevoked = vi.fn(async () => true); // would reject if consulted
    const guardSilent = new JwtGuard(
      stubJwtService,
      configServiceFor(makeAuthConfig()),
      { isRevoked, revoke: vi.fn() } as unknown as RevocationService,
    );
    const ctx = makeContext({ cookies: { FS_AUTH: VALID_TOKEN } });
    await expect(guardSilent.canActivate(ctx)).resolves.toBe(true);
    expect(isRevoked).not.toHaveBeenCalled();
  });

  it('flag ON + jti revoked → rejects with 401', async () => {
    const isRevoked = vi.fn(async () => true);
    const guardOn = new JwtGuard(
      stubJwtService,
      configServiceFor(makeAuthConfig('FS_AUTH', { jtiRevocationEnabled: true })),
      { isRevoked, revoke: vi.fn() } as unknown as RevocationService,
    );
    const ctx = makeContext({ cookies: { FS_AUTH: VALID_TOKEN } });
    await expect(guardOn.canActivate(ctx)).rejects.toThrow();
    expect(isRevoked).toHaveBeenCalledWith(VALID_PAYLOAD.jti);
  });

  it('flag ON + jti NOT revoked → admits as 200', async () => {
    const isRevoked = vi.fn(async () => false);
    const guardOn = new JwtGuard(
      stubJwtService,
      configServiceFor(makeAuthConfig('FS_AUTH', { jtiRevocationEnabled: true })),
      { isRevoked, revoke: vi.fn() } as unknown as RevocationService,
    );
    const ctx = makeContext({ cookies: { FS_AUTH: VALID_TOKEN } });
    await expect(guardOn.canActivate(ctx)).resolves.toBe(true);
    expect(isRevoked).toHaveBeenCalledWith(VALID_PAYLOAD.jti);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Lightweight e2e: build a Nest app with a single guarded route, swap the
// auth config to a custom cookie name, and prove the full HTTP path works.
// This is the regression test the reviewer asked for.
// ─────────────────────────────────────────────────────────────────────────

@Controller('protected')
class TestProtectedController {
  @Get()
  @UseGuards(JwtGuard)
  whoami(): { ok: true } {
    return { ok: true };
  }
}

async function buildAppWithCookieName(name: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TestProtectedController],
    providers: [
      JwtGuard,
      { provide: JwtService, useValue: stubJwtService },
      { provide: ConfigService, useValue: configServiceFor(makeAuthConfig(name)) },
      { provide: RevocationService, useValue: noopRevocationService },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  return app;
}

describe('JwtGuard (e2e via supertest, custom cookie name)', () => {
  it('AUTH_COOKIE_NAME=CUSTOM_AUTH → request with CUSTOM_AUTH cookie returns 200', async () => {
    const app = await buildAppWithCookieName('CUSTOM_AUTH');
    try {
      await request(app.getHttpServer())
        .get('/protected')
        .set('Cookie', `CUSTOM_AUTH=${VALID_TOKEN}`)
        .expect(200, { ok: true });
    } finally {
      await app.close();
    }
  });

  it('AUTH_COOKIE_NAME=CUSTOM_AUTH → request with legacy FS_AUTH cookie returns 401', async () => {
    const app = await buildAppWithCookieName('CUSTOM_AUTH');
    try {
      await request(app.getHttpServer())
        .get('/protected')
        .set('Cookie', `FS_AUTH=${VALID_TOKEN}`)
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
