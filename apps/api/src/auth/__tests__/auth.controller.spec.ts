import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';

const mockAuthService = {
  register: vi.fn(),
  login: vi.fn(),
};

describe('AuthController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    it('returns 201 with Set-Cookie: FS_AUTH', async () => {
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

      expect(res.body).toEqual({
        token: 'jwt-token-abc',
        username: 'alice',
        email: 'alice@example.com',
      });

      // Check Set-Cookie header
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const fsCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
        : cookies;
      expect(fsCookie).toBeDefined();
      expect(fsCookie).toContain('FS_AUTH=jwt-token-abc');
      expect(fsCookie).toContain('HttpOnly');
      expect(fsCookie).toContain('Path=/');
    });

    it('returns 400 for invalid body', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ username: 'al' }) // too short, missing email+password
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 with Set-Cookie: FS_AUTH', async () => {
      mockAuthService.login.mockResolvedValueOnce({
        token: 'jwt-token-def',
        username: 'bob',
        email: 'bob@example.com',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'bob', password: 'Password1' })
        .expect(200);

      expect(res.body).toEqual({
        token: 'jwt-token-def',
        username: 'bob',
        email: 'bob@example.com',
      });

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const fsCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
        : cookies;
      expect(fsCookie).toContain('FS_AUTH=jwt-token-def');
      expect(fsCookie).toContain('HttpOnly');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 204 and clears FS_AUTH cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .expect(204);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const fsCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('FS_AUTH='))
        : cookies;
      expect(fsCookie).toBeDefined();
      // maxAge=0 or Expires in the past → clears cookie
      expect(fsCookie).toMatch(/FS_AUTH=;/);
    });
  });
});
