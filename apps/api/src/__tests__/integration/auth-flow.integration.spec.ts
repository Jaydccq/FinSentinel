/**
 * Auth Flow Integration Test
 *
 * Tests the full register → login → access protected route flow
 * through the real NestJS pipeline (middleware → guards → controllers → services).
 *
 * Infrastructure is mocked: in-memory DB, Map-based Redis.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type createMockRedis } from './test-app.factory';

describe('Auth Flow (integration)', () => {
  let app: INestApplication;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    mockRedis = testApp.mockRedis;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('register → login → access protected route → reject without cookie', async () => {
    const credentials = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'SecurePass1',
    };

    // ── Step 1: Register (browser path: token NOT in body) ───────────────
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(credentials)
      .expect(201);

    expect(registerRes.body).toHaveProperty('username', 'testuser');
    expect(registerRes.body).toHaveProperty('email', 'test@example.com');
    expect(registerRes.body.token).toBeUndefined();

    // Verify Set-Cookie: FS_AUTH
    const registerCookies = registerRes.headers['set-cookie'];
    expect(registerCookies).toBeDefined();
    const registerFsCookie = Array.isArray(registerCookies)
      ? registerCookies.find((c: string) => c.startsWith('FS_AUTH='))
      : registerCookies;
    expect(registerFsCookie).toBeDefined();
    expect(registerFsCookie).toContain('HttpOnly');

    // Extract the token from the Set-Cookie header (the browser-mode source of truth).
    const registerToken = (registerFsCookie!.match(/FS_AUTH=([^;]+)/) ?? [])[1] as string;
    expect(registerToken.length).toBeGreaterThan(10);

    // ── Step 2: Login as desktop client to get the token in the body too. ─
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Client', 'desktop')
      .send({
        username: credentials.username,
        password: credentials.password,
      })
      .expect(200);

    expect(loginRes.body).toHaveProperty('token');
    expect(loginRes.body).toHaveProperty('username', 'testuser');
    const loginToken = loginRes.body.token as string;

    // Verify login also sets FS_AUTH cookie
    const loginCookies = loginRes.headers['set-cookie'];
    expect(loginCookies).toBeDefined();
    const loginFsCookie = Array.isArray(loginCookies)
      ? loginCookies.find((c: string) => c.startsWith('FS_AUTH='))
      : loginCookies;
    expect(loginFsCookie).toContain('FS_AUTH=');
    expect(loginFsCookie).toContain('HttpOnly');

    // ── Step 3: Access protected route WITH token → 200 ──────────────────
    const protectedRes = await request(app.getHttpServer())
      .get('/api/portfolios')
      .set('Cookie', `FS_AUTH=${loginToken}`)
      .expect(200);

    // Should return an array (empty for a new user)
    expect(Array.isArray(protectedRes.body)).toBe(true);

    // ── Step 4: Access protected route WITHOUT token → 401 ───────────────
    await request(app.getHttpServer()).get('/api/portfolios').expect(401);
  });

  it('register with duplicate username returns 409', async () => {
    const credentials = {
      username: 'dupuser',
      email: 'dup@example.com',
      password: 'SecurePass1',
    };

    // First registration succeeds
    await request(app.getHttpServer()).post('/api/auth/register').send(credentials).expect(201);

    // Second registration with same username fails
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        ...credentials,
        email: 'different@example.com',
      })
      .expect(409);
  });

  it('login with wrong password returns 401', async () => {
    const credentials = {
      username: 'wrongpwuser',
      email: 'wrongpw@example.com',
      password: 'SecurePass1',
    };

    // Register
    await request(app.getHttpServer()).post('/api/auth/register').send(credentials).expect(201);

    // Login with wrong password
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        username: credentials.username,
        password: 'WrongPassword1',
      })
      .expect(401);
  });

  it('register with invalid body returns 400', async () => {
    // Missing email and password, username too short
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'ab' })
      .expect(400);
  });

  it('Bearer token in Authorization header also works', async () => {
    const credentials = {
      username: 'beareruser',
      email: 'bearer@example.com',
      password: 'SecurePass1',
    };

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Client', 'desktop')
      .send(credentials)
      .expect(201);

    const token = registerRes.body.token as string;

    // Access protected route using Authorization header instead of cookie
    const res = await request(app.getHttpServer())
      .get('/api/portfolios')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('10 consecutive wrong-password attempts lock the account; clearing the lock key restores access', async () => {
    // The real soft-delay schedule sums to ~30s across 10 fails, which
    // would dwarf this test. Patch the delay to a no-op for the duration
    // of this test only — we still exercise INCR + lock + reset paths.
    const { LoginProtectionService } = await import('../../auth/login-protection.service');
    const proto = LoginProtectionService.prototype;
    const origDelay = proto.computeDelayMs;
    proto.computeDelayMs = () => 0;

    try {
      const credentials = {
        username: 'lockoutuser',
        email: 'lockout@example.com',
        password: 'SecurePass1',
      };

      // Pre-condition: register the account.
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(credentials)
        .expect(201);

      // Drive 10 wrong-password attempts. Each one returns 401.
      // (The supertest client connects from 127.0.0.1, so all attempts share
      // the same (username, ip) lockout key.)
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username: credentials.username, password: 'WrongPass1' })
          .expect(401);
      }

      // 11th attempt — even with the CORRECT password — is locked out.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: credentials.username, password: credentials.password })
        .expect(423);

      // Simulate the 15-min TTL elapsing by clearing the lock key directly.
      // We can't predict the exact IP supertest reports (typically
      // ::ffff:127.0.0.1 or 127.0.0.1) — match the lock prefix instead.
      const lockPrefix = `login:lock:${credentials.username}:`;
      const store = (mockRedis as unknown as { _store: Map<string, string> })._store;
      for (const k of [...store.keys()]) {
        if (k.startsWith(lockPrefix)) store.delete(k);
      }

      // After the lock clears, the correct password works again.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: credentials.username, password: credentials.password })
        .expect(200);
    } finally {
      proto.computeDelayMs = origDelay;
    }
  }, 30_000);

  it('logout clears the FS_AUTH cookie', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/logout').expect(204);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const fsCookie = Array.isArray(cookies)
      ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
      : cookies;
    expect(fsCookie).toBeDefined();
    // Cookie should be cleared (FS_AUTH=; or Expires in the past)
    expect(fsCookie).toMatch(/FS_AUTH=;/);
  });
});
