/**
 * Integration test for item 2 M3 + M4: refresh-tokens flow (rolling rotation,
 * reuse detection, dual-cookie issuance, logout-clears-family) AND jti
 * revocation on logout (M4).
 *
 * The flag-state is set BEFORE `./setup` is imported (which itself imports
 * AppModule transitively, so by the time AuthRuntimeConfig is built the env
 * vars are in place). This spec lives in a separate file from
 * `auth-flow.integration.spec.ts` so flag-OFF and flag-ON wiring don't share
 * a process-wide ConfigService instance.
 */
process.env['AUTH_REFRESH_TOKENS_ENABLED'] = 'true';
process.env['AUTH_JTI_REVOCATION_ENABLED'] = 'true';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app.factory';

describe('Auth Refresh + Revocation Flow (integration, flags ON)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    delete process.env['AUTH_REFRESH_TOKENS_ENABLED'];
    delete process.env['AUTH_JTI_REVOCATION_ENABLED'];
  });

  /**
   * Helper: pluck a Set-Cookie value (e.g. 'FS_REFRESH=xxx; Path=...; HttpOnly')
   * out of supertest's headers and return just the cookie name=value pair so
   * it can be re-attached on subsequent requests.
   */
  function extractCookiePair(setCookies: string[] | string | undefined, name: string): string | undefined {
    if (!setCookies) return undefined;
    const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
    const found = arr.find((c) => c.startsWith(`${name}=`));
    if (!found) return undefined;
    const semi = found.indexOf(';');
    return semi === -1 ? found : found.slice(0, semi);
  }

  it('register issues both FS_AUTH and FS_REFRESH; /api/auth/refresh rotates and returns 204', async () => {
    const credentials = {
      username: 'refreshuser',
      email: 'refresh@example.com',
      password: 'SecurePass1',
    };

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(credentials)
      .expect(201);

    const setCookies = registerRes.headers['set-cookie'] as string[] | string | undefined;
    const fsAuth1 = extractCookiePair(setCookies, 'FS_AUTH');
    const fsRefresh1 = extractCookiePair(setCookies, 'FS_REFRESH');
    expect(fsAuth1).toBeDefined();
    expect(fsRefresh1).toBeDefined();

    // Hit refresh — supertest needs both cookies; the API only reads
    // FS_REFRESH but cookieParser will surface both.
    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `${fsAuth1}; ${fsRefresh1}`)
      .expect(204);

    const newCookies = refreshRes.headers['set-cookie'] as string[] | string | undefined;
    const fsAuth2 = extractCookiePair(newCookies, 'FS_AUTH');
    const fsRefresh2 = extractCookiePair(newCookies, 'FS_REFRESH');
    expect(fsAuth2).toBeDefined();
    expect(fsRefresh2).toBeDefined();
    // Rotated → new refresh value differs from initial.
    expect(fsRefresh2).not.toEqual(fsRefresh1);

    // The newly minted access cookie is accepted by JwtGuard.
    await request(app.getHttpServer())
      .get('/api/portfolios')
      .set('Cookie', fsAuth2!)
      .expect(200);
  });

  it('replaying an OLD refresh after rotation triggers reuse detection (401, family revoked)', async () => {
    const credentials = {
      username: 'reuseuser',
      email: 'reuse@example.com',
      password: 'SecurePass1',
    };
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(credentials)
      .expect(201);

    const fsRefreshOld = extractCookiePair(
      registerRes.headers['set-cookie'] as string[] | string | undefined,
      'FS_REFRESH',
    );
    expect(fsRefreshOld).toBeDefined();

    // First rotation succeeds.
    const r1 = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', fsRefreshOld!)
      .expect(204);

    const fsRefreshNew = extractCookiePair(
      r1.headers['set-cookie'] as string[] | string | undefined,
      'FS_REFRESH',
    );
    expect(fsRefreshNew).toBeDefined();
    expect(fsRefreshNew).not.toEqual(fsRefreshOld);

    // Replay the OLD refresh → reuse detected → 401.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', fsRefreshOld!)
      .expect(401);

    // After reuse-induced family revocation, even the (legit) NEW refresh
    // is dead.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', fsRefreshNew!)
      .expect(401);
  });

  it('after logout, the captured access cookie is rejected on a protected route (M4 jti revocation)', async () => {
    const credentials = {
      username: 'logoutuser',
      email: 'logout@example.com',
      password: 'SecurePass1',
    };
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(credentials)
      .expect(201);

    const fsAuth = extractCookiePair(
      registerRes.headers['set-cookie'] as string[] | string | undefined,
      'FS_AUTH',
    );
    const fsRefresh = extractCookiePair(
      registerRes.headers['set-cookie'] as string[] | string | undefined,
      'FS_REFRESH',
    );
    expect(fsAuth).toBeDefined();
    expect(fsRefresh).toBeDefined();

    // Confirm pre-logout: protected route accepts the access cookie.
    await request(app.getHttpServer())
      .get('/api/portfolios')
      .set('Cookie', fsAuth!)
      .expect(200);

    // Logout. Both flags are on, so:
    //   - jti of the access cookie goes into revoked_jti:* in Redis
    //   - refresh family is DEL'd
    //
    // The CSRF middleware blocks state-changing cookie-auth requests,
    // so we send the matching X-CSRF-Token + Origin header.
    const fsCsrf = extractCookiePair(
      registerRes.headers['set-cookie'] as string[] | string | undefined,
      'FS_CSRF',
    );
    const csrfValue = fsCsrf ? fsCsrf.slice('FS_CSRF='.length) : '';
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', `${fsAuth}; ${fsRefresh}; ${fsCsrf}`)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', csrfValue)
      .expect(204);

    // POST-logout: the captured FS_AUTH cookie is now in the jti blacklist
    // and JwtGuard returns 401.
    await request(app.getHttpServer())
      .get('/api/portfolios')
      .set('Cookie', fsAuth!)
      .expect(401);
  });
});
