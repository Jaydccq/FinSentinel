import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import type { AuthRuntimeConfig } from '../../config/auth.config';

const mockAuthService = {
  register: vi.fn(),
  login: vi.fn(),
};

function makeAuthConfig(overrides: Partial<AuthRuntimeConfig['cookie']> = {}): AuthRuntimeConfig {
  return {
    cookie: {
      name: 'FS_AUTH',
      secure: false,
      sameSite: 'lax',
      maxAgeMs: 86_400_000,
      ...overrides,
    },
    corsOrigins: ['http://localhost:3000', 'http://localhost:5173'],
  };
}

async function buildApp(
  authRuntimeConfig: AuthRuntimeConfig = makeAuthConfig(),
): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: mockAuthService },
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
  });
});
