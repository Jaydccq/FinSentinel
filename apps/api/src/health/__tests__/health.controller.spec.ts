import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from '../health.controller';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T,>(k: string): T | undefined => env[k] as T | undefined,
  } as ConfigService;
}

async function build(opts: {
  db?: { execute?: ReturnType<typeof vi.fn> } | null;
  redis?: { ping?: ReturnType<typeof vi.fn> } | null;
  env?: Record<string, string | undefined>;
}) {
  const env = opts.env ?? {
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'sk-test',
    POLYGON_API_KEY: 'poly-test',
    STORAGE_PROVIDER: 'rustfs',
  };
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: 'DRIZZLE_DB', useValue: opts.db ?? null },
      { provide: 'REDIS', useValue: opts.redis ?? null },
      { provide: ConfigService, useValue: makeConfig(env) },
    ],
  }).compile();
  return module.get(HealthController);
}

describe('HealthController', () => {
  describe('GET /health (cheap liveness)', () => {
    it('returns {status: ok}', async () => {
      const ctrl = await build({});
      expect(ctrl.check()).toEqual({ status: 'ok' });
    });
  });

  describe('GET /health/components — happy path', () => {
    it('reports all probes up when DB+Redis succeed and env keys are present', async () => {
      const ctrl = await build({
        db: { execute: vi.fn().mockResolvedValue([]) },
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
      });
      const res = await ctrl.components();
      expect(res.status).toBe('ok');
      expect(res.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const names = res.components.map((c) => c.name);
      expect(names).toEqual(['database', 'redis', 'ai_provider', 'market_provider', 'storage']);
      expect(res.components.every((c) => c.up)).toBe(true);
    });

    it('records latencyMs for probed components', async () => {
      const ctrl = await build({
        db: { execute: vi.fn().mockResolvedValue([]) },
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
      });
      const res = await ctrl.components();
      const dbProbe = res.components.find((c) => c.name === 'database')!;
      const redisProbe = res.components.find((c) => c.name === 'redis')!;
      expect(dbProbe.latencyMs).toBeGreaterThanOrEqual(0);
      expect(redisProbe.latencyMs).toBeGreaterThanOrEqual(0);
      // Config-only probes report null latency.
      expect(res.components.find((c) => c.name === 'ai_provider')!.latencyMs).toBeNull();
    });
  });

  describe('GET /health/components — failure surfacing', () => {
    it('flips status to "degraded" when DB throws', async () => {
      const ctrl = await build({
        db: { execute: vi.fn().mockRejectedValue(new Error('connection refused')) },
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
      });
      const res = await ctrl.components();
      expect(res.status).toBe('degraded');
      const db = res.components.find((c) => c.name === 'database')!;
      expect(db.up).toBe(false);
      expect(db.error).toMatch(/connection refused/);
    });

    it('flips status to "degraded" when Redis returns unexpected reply', async () => {
      const ctrl = await build({
        db: { execute: vi.fn().mockResolvedValue([]) },
        redis: { ping: vi.fn().mockResolvedValue('NOPE') },
      });
      const res = await ctrl.components();
      expect(res.status).toBe('degraded');
      const redis = res.components.find((c) => c.name === 'redis')!;
      expect(redis.up).toBe(false);
      expect(redis.error).toMatch(/unexpected reply/);
    });

    it('marks ai_provider down when API key is unset', async () => {
      const ctrl = await build({
        db: { execute: vi.fn().mockResolvedValue([]) },
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
        env: {
          AI_PROVIDER: 'openrouter',
          // OPENROUTER_API_KEY missing
          POLYGON_API_KEY: 'poly-test',
          STORAGE_PROVIDER: 'rustfs',
        },
      });
      const res = await ctrl.components();
      expect(res.status).toBe('degraded');
      const ai = res.components.find((c) => c.name === 'ai_provider')!;
      expect(ai.up).toBe(false);
      expect(ai.error).toMatch(/OPENROUTER_API_KEY is unset/);
    });

    it('uses NVIDIA_API_KEY when AI_PROVIDER=nvidia', async () => {
      const ctrl = await build({
        db: { execute: vi.fn().mockResolvedValue([]) },
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
        env: {
          AI_PROVIDER: 'nvidia',
          NVIDIA_API_KEY: 'nv-test',
          POLYGON_API_KEY: 'poly-test',
          STORAGE_PROVIDER: 'rustfs',
        },
      });
      const res = await ctrl.components();
      const ai = res.components.find((c) => c.name === 'ai_provider')!;
      expect(ai.up).toBe(true);
      expect(ai.detail).toBe('nvidia');
    });

    it('marks market_provider down when POLYGON_API_KEY is unset', async () => {
      const ctrl = await build({
        db: { execute: vi.fn().mockResolvedValue([]) },
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
        env: {
          AI_PROVIDER: 'openrouter',
          OPENROUTER_API_KEY: 'sk-test',
          STORAGE_PROVIDER: 'rustfs',
        },
      });
      const res = await ctrl.components();
      const mp = res.components.find((c) => c.name === 'market_provider')!;
      expect(mp.up).toBe(false);
    });

    it('reports DB not bound when injection is null (test harness without DB)', async () => {
      const ctrl = await build({ db: null });
      const res = await ctrl.components();
      const db = res.components.find((c) => c.name === 'database')!;
      expect(db.up).toBe(false);
      expect(db.error).toMatch(/DB not bound/);
    });
  });
});
