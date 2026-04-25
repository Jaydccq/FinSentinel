import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // Provide dummy env for e2e tests — no real infra needed
          load: [
            () => ({
              database: { url: 'postgresql://test:test@localhost:5432/test' },
              redis: { url: 'redis://localhost:6379' },
              jwt: { secret: 'a'.repeat(32), expiration: 86400000 },
            }),
          ],
        }),
      ],
      controllers: [HealthController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health → 200 with { status: "ok" }', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });
});
