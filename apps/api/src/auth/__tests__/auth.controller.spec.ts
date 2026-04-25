import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { JwtService } from '../jwt.service';
import { RefreshService } from '../refresh.service';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { MetricsService } from '../../common/services/metrics.service';
import type { AuthRuntimeConfig } from '../../config/auth.config';

const mockAuthService = {
  register: vi.fn(),
  login: vi.fn(),
};

const mockJwtService = {
  // generateAccessToken called only when refreshTokensEnabled=true
  generateAccessToken: vi.fn(async () => ({
    token: 'access-jwt-from-jwtsvc',
    jti: '11111111-1111-4111-8111-111111111111',
    expSeconds: Math.floor(Date.now() / 1000) + 900,
  })),
};

const mockRefreshService = {
  issueNewFamily: vi.fn(async () => ({
    token: 'refresh-jwt-from-refreshsvc',
    jti: '22222222-2222-4222-8222-222222222222',
    familyId: '33333333-3333-4333-8333-333333333333',
    expSeconds: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  })),
  rotate: vi.fn(),
  peek: vi.fn(),
  invalidateFamily: vi.fn(async () => undefined),
};

function makeAuthConfig(
  overrides: Partial<AuthRuntimeConfig['cookie']> = {},
  flagOverrides: Partial<
    Pick<
      AuthRuntimeConfig,
      'refreshTokensEnabled' | 'accessTokenTtlMsWhenRefreshOn' | 'refreshTokenTtlMs'
    >
  > = {},
): AuthRuntimeConfig {
  return {
    cookie: {
      name: 'FS_AUTH',
      secure: false,
      sameSite: 'lax',
      maxAgeMs: 86_400_000,
      ...overrides,
    },
    corsOrigins: ['http://localhost:3000', 'http://localhost:5173'],
    refreshTokensEnabled: false,
    accessTokenTtlMsWhenRefreshOn: 15 * 60 * 1000,
    refreshTokenTtlMs: 7 * 24 * 60 * 60 * 1000,
    ...flagOverrides,
  };
}

// Permissive rate-limiter stub so the @UseGuards(RateLimitGuard) on /login
// doesn't block tests. Per-IP throttling is exercised in the integration
// tests where a real Redis-backed limiter is wired up.
const permissiveRateLimiter = {
  check: vi.fn().mockResolvedValue({ allowed: true, remaining: 19, retryAfterMs: 0 }),
};
const noopMetrics = {
  startHistogramTimer: () => () => {},
  incrementCounter: () => {},
  setGauge: () => {},
};

async function buildApp(
  authRuntimeConfig: AuthRuntimeConfig = makeAuthConfig(),
): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: mockAuthService },
      { provide: JwtService, useValue: mockJwtService },
      { provide: RefreshService, useValue: mockRefreshService },
      RateLimitGuard,
      { provide: RateLimiterService, useValue: permissiveRateLimiter },
      { provide: MetricsService, useValue: noopMetrics },
      {
        provide: ConfigService,
        useValue: {
          get: <T>(key: string): T | undefined => {
            if (key === 'auth') return authRuntimeConfig as unknown as T;
            return undefined;
          },
        },
      },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

describe('AuthController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    it('returns 201 with Set-Cookie: FS_AUTH and a body that does NOT contain token (browser default)', async () => {
      mockAuthService.register.mockResolvedValueOnce({
        token: 'jwt-token-abc',
        username: 'alice',
        email: 'alice@example.com',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password1',
        })
        .expect(201);

      // Browser path: token NOT in body, only username + email.
      expect(res.body).toEqual({ username: 'alice', email: 'alice@example.com' });
      expect(res.body.token).toBeUndefined();

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const fsCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
        : cookies;
      expect(fsCookie).toBeDefined();
      expect(fsCookie).toContain('FS_AUTH=jwt-token-abc');
      expect(fsCookie).toContain('HttpOnly');
      expect(fsCookie).toContain('Path=/');

      // F-9 M1 (2026-04-24): CSRF cookie must also be set, must NOT be HttpOnly
      // (frontend JS reads it for the X-CSRF-Token double-submit), and must
      // carry a non-empty value (UUID v4).
      const csrfCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_CSRF='))
        : undefined;
      expect(csrfCookie).toBeDefined();
      expect(csrfCookie).not.toContain('HttpOnly');
      expect(csrfCookie).toMatch(/FS_CSRF=[^;]+/);
      expect(csrfCookie).toContain('Path=/');
    });

    it('returns the token in the body when X-Client: desktop is set', async () => {
      mockAuthService.register.mockResolvedValueOnce({
        token: 'jwt-token-abc',
        username: 'alice',
        email: 'alice@example.com',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .set('X-Client', 'desktop')
        .send({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password1',
        })
        .expect(201);

      expect(res.body).toEqual({
        token: 'jwt-token-abc',
        username: 'alice',
        email: 'alice@example.com',
      });
    });

    it('returns 400 for invalid body', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ username: 'al' }) // too short, missing email+password
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 with Set-Cookie: FS_AUTH and no token in body (browser)', async () => {
      mockAuthService.login.mockResolvedValueOnce({
        token: 'jwt-token-def',
        username: 'bob',
        email: 'bob@example.com',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'bob', password: 'Password1' })
        .expect(200);

      expect(res.body).toEqual({ username: 'bob', email: 'bob@example.com' });
      expect(res.body.token).toBeUndefined();

      const cookies = res.headers['set-cookie'];
      const fsCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
        : cookies;
      expect(fsCookie).toContain('FS_AUTH=jwt-token-def');
      expect(fsCookie).toContain('HttpOnly');

      // F-9 M1: login also issues a fresh FS_CSRF cookie.
      const csrfCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_CSRF='))
        : undefined;
      expect(csrfCookie).toBeDefined();
      expect(csrfCookie).not.toContain('HttpOnly');
      expect(csrfCookie).toMatch(/FS_CSRF=[^;]+/);
    });

    it('returns the token in the body for X-Client: desktop', async () => {
      mockAuthService.login.mockResolvedValueOnce({
        token: 'jwt-token-def',
        username: 'bob',
        email: 'bob@example.com',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Client', 'desktop')
        .send({ username: 'bob', password: 'Password1' })
        .expect(200);

      expect(res.body).toEqual({
        token: 'jwt-token-def',
        username: 'bob',
        email: 'bob@example.com',
      });
    });
  });

  describe('cookie attrs from typed config (P0-3)', () => {
    afterEach(async () => {
      await app.close();
    });

    it('Set-Cookie reflects secure=true + SameSite=Strict when env says so', async () => {
      app = await buildApp(makeAuthConfig({ secure: true, sameSite: 'strict', maxAgeMs: 60_000 }));
      mockAuthService.login.mockResolvedValueOnce({
        token: 'tk',
        username: 'u',
        email: 'u@x',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'u', password: 'P1' })
        .expect(200);

      const cookies = res.headers['set-cookie'];
      const fsCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
        : cookies;
      expect(fsCookie).toContain('Secure');
      expect(fsCookie).toContain('SameSite=Strict');
      // Max-Age in seconds (60).
      expect(fsCookie).toMatch(/Max-Age=60(?:;|$)/);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 204 and clears FS_AUTH cookie', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/logout').expect(204);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const fsCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
        : cookies;
      expect(fsCookie).toBeDefined();
      expect(fsCookie).toMatch(/FS_AUTH=;/);

      // F-9 M1: logout also clears FS_CSRF.
      const csrfCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_CSRF='))
        : undefined;
      expect(csrfCookie).toBeDefined();
      expect(csrfCookie).toMatch(/FS_CSRF=;/);
    });

    it('flag OFF default: does NOT clear FS_REFRESH (preserves byte-identical behavior)', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/logout').expect(204);
      const cookies = res.headers['set-cookie'];
      const refreshCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_REFRESH='))
        : undefined;
      // Flag is off by default → no FS_REFRESH cookie clearing instruction.
      expect(refreshCookie).toBeUndefined();
    });
  });

  // ── Item 2 M3: refresh tokens flag ON ─────────────────────────────────
  describe('AUTH_REFRESH_TOKENS_ENABLED=true', () => {
    let flagApp: INestApplication;

    beforeEach(async () => {
      vi.clearAllMocks();
      flagApp = await buildApp(makeAuthConfig({}, { refreshTokensEnabled: true }));
    });

    afterEach(async () => {
      await flagApp.close();
    });

    it('register sets BOTH FS_AUTH and FS_REFRESH cookies', async () => {
      mockAuthService.register.mockResolvedValueOnce({
        // Real-looking token so decodeUidFromToken can recover the uid.
        token: await makeFakeAccessToken(),
        username: 'alice',
        email: 'alice@example.com',
      });
      const res = await request(flagApp.getHttpServer())
        .post('/api/auth/register')
        .send({ username: 'alice', email: 'alice@example.com', password: 'Password1' })
        .expect(201);

      const cookies = res.headers['set-cookie'] as string[] | string;
      const arr = Array.isArray(cookies) ? cookies : [cookies];
      const fsAuth = arr.find((c) => c.startsWith('FS_AUTH='));
      const fsRefresh = arr.find((c) => c.startsWith('FS_REFRESH='));
      expect(fsAuth).toBeDefined();
      expect(fsRefresh).toBeDefined();
      // Refresh cookie must be path-scoped to /api/auth/refresh.
      expect(fsRefresh).toContain('Path=/api/auth/refresh');
      expect(fsRefresh).toContain('HttpOnly');
    });

    it('login sets BOTH FS_AUTH and FS_REFRESH cookies', async () => {
      mockAuthService.login.mockResolvedValueOnce({
        token: await makeFakeAccessToken(),
        username: 'bob',
        email: 'bob@example.com',
      });
      const res = await request(flagApp.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'bob', password: 'Password1' })
        .expect(200);

      const cookies = res.headers['set-cookie'] as string[] | string;
      const arr = Array.isArray(cookies) ? cookies : [cookies];
      expect(arr.some((c) => c.startsWith('FS_AUTH='))).toBe(true);
      expect(arr.some((c) => c.startsWith('FS_REFRESH='))).toBe(true);
    });

    it('logout clears FS_AUTH, FS_CSRF, and FS_REFRESH cookies', async () => {
      const res = await request(flagApp.getHttpServer())
        .post('/api/auth/logout')
        .expect(204);
      const cookies = res.headers['set-cookie'] as string[] | string;
      const arr = Array.isArray(cookies) ? cookies : [cookies];
      expect(arr.some((c) => /^FS_AUTH=;/.test(c))).toBe(true);
      expect(arr.some((c) => /^FS_CSRF=;/.test(c))).toBe(true);
      expect(arr.some((c) => /^FS_REFRESH=;/.test(c))).toBe(true);
    });

    it('POST /api/auth/refresh with no FS_REFRESH cookie returns 401', async () => {
      await request(flagApp.getHttpServer()).post('/api/auth/refresh').expect(401);
    });

    it('POST /api/auth/refresh with bad FS_REFRESH cookie returns 401', async () => {
      mockRefreshService.rotate.mockResolvedValueOnce(null);
      await request(flagApp.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'FS_REFRESH=garbage')
        .expect(401);
      expect(mockRefreshService.rotate).toHaveBeenCalledWith('garbage');
    });

    it('POST /api/auth/refresh with valid cookie issues new FS_AUTH + FS_REFRESH and returns 204', async () => {
      mockRefreshService.rotate.mockResolvedValueOnce({
        token: 'new-refresh-token',
        jti: 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr',
        familyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expSeconds: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      });
      mockRefreshService.peek.mockResolvedValueOnce({
        username: 'alice',
        userId: '00000000-0000-4000-8000-000000000001',
        familyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      });
      const res = await request(flagApp.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'FS_REFRESH=current-valid')
        .expect(204);

      const cookies = res.headers['set-cookie'] as string[] | string;
      const arr = Array.isArray(cookies) ? cookies : [cookies];
      expect(arr.some((c) => c.startsWith('FS_AUTH='))).toBe(true);
      expect(arr.some((c) => c.startsWith('FS_REFRESH=new-refresh-token'))).toBe(true);
      expect(arr.some((c) => c.startsWith('FS_CSRF='))).toBe(true);
    });
  });

  // ── Flag OFF surface area: refresh endpoint must 404 ──────────────────
  describe('AUTH_REFRESH_TOKENS_ENABLED=false (default)', () => {
    it('POST /api/auth/refresh returns 404 (endpoint not exposed)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'FS_REFRESH=anything')
        .expect(404);
    });
  });
});

/**
 * Build a minimally-shaped real JWT so the controller's `decodeUidFromToken`
 * helper can recover a `uid` claim. We don't verify signatures here — the
 * mocked AuthService merely returns this string back, and the controller
 * decodes (no verify) to pull `uid` for `setAuthCookies`.
 */
async function makeFakeAccessToken(): Promise<string> {
  const { SignJWT } = await import('jose');
  const secret = new TextEncoder().encode('a'.repeat(32));
  return new SignJWT({ uid: '00000000-0000-4000-8000-000000000001' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('alice')
    .setIssuer('finsentinel-api')
    .setAudience('finsentinel-web')
    .setJti('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
    .sign(secret);
}
