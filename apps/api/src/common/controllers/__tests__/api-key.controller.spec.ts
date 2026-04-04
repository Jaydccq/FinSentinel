import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ApiKeyController } from '../api-key.controller';
import { ApiKeyService } from '../../services/api-key.service';
import { JwtGuard } from '../../../auth/jwt.guard';

const USER_ID = '11111111-2222-3333-4444-555555555555';

const mockApiKeyService = {
  listStatus: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
};

const fakeJwtGuard = {
  canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
    const req = context.switchToHttp().getRequest();
    req['user'] = { userId: USER_ID, username: 'tester' };
    return true;
  },
};

describe('ApiKeyController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [ApiKeyController],
      providers: [{ provide: ApiKeyService, useValue: mockApiKeyService }],
    })
      .overrideGuard(JwtGuard)
      .useValue(fakeJwtGuard)
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a stable test response shape for API key checks', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/settings/api-keys/POLYGON/test')
      .expect(200);

    expect(res.body).toEqual({
      success: false,
      message: 'API key connectivity test is not implemented yet.',
    });
  });
});
