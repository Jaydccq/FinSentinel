import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  Controller,
  Get,
  Post,
  MiddlewareConsumer,
  Module,
  NestModule,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { CsrfMiddleware } from '../csrf.middleware';
import type { AuthRuntimeConfig } from '../../config/auth.config';

const AUTH_COOKIE = 'FS_AUTH=jwt-test-token';
const CSRF_COOKIE_VALUE = 'csrf-uuid-abc';
const ALLOWED_ORIGIN = 'http://localhost:3000';

@Controller()
class StubController {
  @Get('/api/portfolios')
  read(): { ok: true } {
    return { ok: true };
  }

  @Post('/api/portfolios')
  write(): { ok: true } {
    return { ok: true };
  }

  @Post('/api/auth/login')
  login(): { ok: true } {
    return { ok: true };
  }

  @Post('/api/health')
  // Health is GET in production, but we expose POST here only to exercise
  // the allow-list path through the middleware.
  health(): { ok: true } {
    return { ok: true };
  }
}

function buildConfig(overrides: Partial<AuthRuntimeConfig> = {}): AuthRuntimeConfig {
  return {
    cookie: {
      name: 'FS_AUTH',
      secure: false,
      sameSite: 'lax',
      maxAgeMs: 86_400_000,
    },
    corsOrigins: [ALLOWED_ORIGIN, 'http://localhost:5173'],
    ...overrides,
  };
}

@Module({
  controllers: [StubController],
  providers: [
    CsrfMiddleware,
    {
      provide: ConfigService,
      useValue: {
        get: <T>(key: string): T | undefined => {
          if (key === 'auth') return buildConfig() as unknown as T;
          return undefined;
        },
      },
    },
  ],
})
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}

describe('CsrfMiddleware', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET requests pass through without CSRF enforcement', async () => {
    await request(app.getHttpServer())
      .get('/api/portfolios')
      .set('Cookie', AUTH_COOKIE)
      .expect(200);
  });

  it('POST to allow-listed path (login) passes through without CSRF', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'a', password: 'b' })
      .expect(201);
  });

  it('POST to /api/health (allow-listed) passes through', async () => {
    await request(app.getHttpServer()).post('/api/health').expect(201);
  });

  it('POST without auth cookie passes through (bearer/SDK callers)', async () => {
    // No FS_AUTH cookie → not vulnerable to CSRF, middleware should let it
    // through. Downstream the JwtGuard would handle 401, but in this stub
    // we have no guard so the controller responds 201.
    await request(app.getHttpServer()).post('/api/portfolios').expect(201);
  });

  it('POST with auth cookie but no Origin/Referer → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/portfolios')
      .set('Cookie', `${AUTH_COOKIE}; FS_CSRF=${CSRF_COOKIE_VALUE}`)
      .set('X-CSRF-Token', CSRF_COOKIE_VALUE)
      .expect(403);
  });

  it('POST with matching Origin but no X-CSRF-Token header → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/portfolios')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', `${AUTH_COOKIE}; FS_CSRF=${CSRF_COOKIE_VALUE}`)
      .expect(403);
  });

  it('POST with matching Origin and wrong X-CSRF-Token → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/portfolios')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', `${AUTH_COOKIE}; FS_CSRF=${CSRF_COOKIE_VALUE}`)
      .set('X-CSRF-Token', 'wrong-value')
      .expect(403);
  });

  it('POST with matching Origin AND matching X-CSRF-Token → pass through', async () => {
    await request(app.getHttpServer())
      .post('/api/portfolios')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', `${AUTH_COOKIE}; FS_CSRF=${CSRF_COOKIE_VALUE}`)
      .set('X-CSRF-Token', CSRF_COOKIE_VALUE)
      .expect(201);
  });

  it('POST with Origin NOT in corsOrigins → 403 even if CSRF token matches', async () => {
    await request(app.getHttpServer())
      .post('/api/portfolios')
      .set('Origin', 'https://evil.example.com')
      .set('Cookie', `${AUTH_COOKIE}; FS_CSRF=${CSRF_COOKIE_VALUE}`)
      .set('X-CSRF-Token', CSRF_COOKIE_VALUE)
      .expect(403);
  });

  it('Referer is accepted as a fallback when Origin is missing', async () => {
    await request(app.getHttpServer())
      .post('/api/portfolios')
      .set('Referer', `${ALLOWED_ORIGIN}/dashboard`)
      .set('Cookie', `${AUTH_COOKIE}; FS_CSRF=${CSRF_COOKIE_VALUE}`)
      .set('X-CSRF-Token', CSRF_COOKIE_VALUE)
      .expect(201);
  });
});
