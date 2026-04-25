import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { TradingGuardsService } from '../trading-guards.service';

const TEST_USER = '11111111-1111-1111-1111-111111111111';

function createMockRedis(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    exists: vi.fn(async (k: string) => (store[k] != null ? 1 : 0)),
    get: vi.fn(async (k: string) => store[k] ?? null),
    /**
     * Mirrors ioredis's variadic set signature including the NX flag used
     * by the per-day counter seed: redis.set(k, v, 'EX', ttl, 'NX').
     * NX causes set to be a no-op when the key already exists.
     */
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      const isNx = args.includes('NX');
      if (isNx && store[k] != null) return null;
      store[k] = v;
      return 'OK';
    }),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => {
      store[k] = v;
      return 'OK';
    }),
    /**
     * Atomic INCRBY — creates the key at 0 if absent, returns the post-
     * increment value. Negative deltas roll back. ioredis returns Number;
     * we mirror that.
     */
    incrby: vi.fn(async (k: string, delta: number) => {
      const cur = store[k] != null ? Number(store[k]) : 0;
      const next = cur + delta;
      store[k] = String(next);
      return next;
    }),
    del: vi.fn(async (k: string) => {
      const had = store[k] != null;
      delete store[k];
      return had ? 1 : 0;
    }),
    _store: store,
  };
}

function createMockDb(executedRows: Array<{ qty: string | null; amount: string | null; price: string | null }> = []) {
  // The guards service does:
  //   db.select({...}).from(orderLedger).where(and(...))
  // Each step needs to be chainable; the final `.where(...)` must be a
  // thenable that resolves to the rows array.
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue(executedRows);
  const select = vi.fn().mockReturnValue(chain);
  return { select, _executedRows: executedRows, _chain: chain };
}

async function buildService(
  cfg: {
    liveGuardsEnabled?: boolean;
    livePerOrderNotionalUsd?: number;
    livePerDayNotionalUsd?: number;
  } = { liveGuardsEnabled: true, livePerOrderNotionalUsd: 10_000, livePerDayNotionalUsd: 50_000 },
  redis: ReturnType<typeof createMockRedis> = createMockRedis(),
  db: ReturnType<typeof createMockDb> = createMockDb(),
) {
  const config: Pick<ConfigService, 'get'> = {
    get: <T,>(key: string): T | undefined =>
      key === 'trading' ? (cfg as unknown as T) : undefined,
  };
  const module = await Test.createTestingModule({
    providers: [
      TradingGuardsService,
      { provide: 'REDIS', useValue: redis },
      { provide: 'DRIZZLE_DB', useValue: db },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  const service = module.get(TradingGuardsService);
  return { service, redis, db };
}

describe('TradingGuardsService', () => {
  describe('flag OFF (default)', () => {
    it('preflight is a no-op — does not consult Redis or DB', async () => {
      const { service, redis, db } = await buildService({ liveGuardsEnabled: false });
      await service.preflight({
        userId: TEST_USER,
        operations: [{ symbol: 'AAPL', action: 'BUY', amount: '999999999' }],
      });
      expect(redis.exists).not.toHaveBeenCalled();
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('kill switch', () => {
    it('engaged → preflight throws 503', async () => {
      const redis = createMockRedis({ 'trading:kill_switch': '{"reason":"halt"}' });
      const module = await Test.createTestingModule({
        providers: [
          TradingGuardsService,
          { provide: 'REDIS', useValue: redis },
          { provide: 'DRIZZLE_DB', useValue: createMockDb() },
          {
            provide: ConfigService,
            useValue: {
              get: () => ({ liveGuardsEnabled: true, livePerOrderNotionalUsd: 10_000, livePerDayNotionalUsd: 50_000 }),
            },
          },
        ],
      }).compile();
      const service = module.get(TradingGuardsService);
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '100' }],
        }),
      ).rejects.toThrow(HttpException);
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '100' }],
        }),
      ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    });

    it('cleared → preflight resumes normal flow', async () => {
      const { service, redis } = await buildService();
      await service.setKillSwitch('halt');
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '100' }],
        }),
      ).rejects.toThrow(HttpException);
      await service.clearKillSwitch();
      expect(redis._store['trading:kill_switch']).toBeUndefined();
      // Now normal preflight passes.
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '100' }],
        }),
      ).resolves.toMatchObject({ reservedCents: expect.any(Number) });
    });

    it('killSwitchStatus reflects engaged + reason', async () => {
      const { service } = await buildService();
      expect((await service.killSwitchStatus()).engaged).toBe(false);
      await service.setKillSwitch('emergency stop');
      const status = await service.killSwitchStatus();
      expect(status.engaged).toBe(true);
      expect(status.reason).toBe('emergency stop');
    });
  });

  describe('per-order notional cap', () => {
    it('amount > limit → ForbiddenException', async () => {
      const { service } = await buildService({
        liveGuardsEnabled: true,
        livePerOrderNotionalUsd: 1_000,
        livePerDayNotionalUsd: 0,
      });
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '1500' }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('amount = limit → allowed (boundary)', async () => {
      const { service } = await buildService({
        liveGuardsEnabled: true,
        livePerOrderNotionalUsd: 1_000,
        livePerDayNotionalUsd: 0,
      });
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '1000' }],
        }),
      ).resolves.toMatchObject({ reservedCents: expect.any(Number) });
    });

    it('qty * indicativePrice > limit → ForbiddenException', async () => {
      const { service } = await buildService({
        liveGuardsEnabled: true,
        livePerOrderNotionalUsd: 1_000,
        livePerDayNotionalUsd: 0,
      });
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', qty: '10', indicativePrice: '150' }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('unpriceable op (qty without price, no amount) → fail-closed Forbidden', async () => {
      const { service } = await buildService({
        liveGuardsEnabled: true,
        livePerOrderNotionalUsd: 1_000,
        livePerDayNotionalUsd: 0,
      });
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', qty: '10' }],
        }),
      ).rejects.toThrow(/Cannot determine notional/);
    });

    it('per-order cap = 0 → no per-order check, daily cap still applied', async () => {
      const { service } = await buildService({
        liveGuardsEnabled: true,
        livePerOrderNotionalUsd: 0,
        livePerDayNotionalUsd: 5_000,
      });
      // Single huge order, no per-order limit. Per-day cap doesn't trip on
      // a 10000 amount when day so far is empty unless the proposed sum
      // alone exceeds it.
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '4999' }],
        }),
      ).resolves.toMatchObject({ reservedCents: expect.any(Number) });

      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '5001' }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('per-day cumulative cap', () => {
    it('today_sum + proposed > limit → ForbiddenException', async () => {
      const { service } = await buildService(
        { liveGuardsEnabled: true, livePerOrderNotionalUsd: 50_000, livePerDayNotionalUsd: 10_000 },
        createMockRedis(),
        createMockDb([
          // Two earlier executed orders today — $7k spent.
          { qty: null, amount: '5000', price: null },
          { qty: '20', amount: null, price: '100' },
        ]),
      );
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '4000' }],
        }),
      ).rejects.toThrow(/Per-day notional cap would be exceeded/);
    });

    it('today_sum + proposed ≤ limit → allowed', async () => {
      const { service } = await buildService(
        { liveGuardsEnabled: true, livePerOrderNotionalUsd: 50_000, livePerDayNotionalUsd: 10_000 },
        createMockRedis(),
        createMockDb([
          { qty: null, amount: '5000', price: null },
          { qty: '20', amount: null, price: '100' },
        ]),
      );
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '3000' }],
        }),
      ).resolves.toMatchObject({ reservedCents: expect.any(Number) });
    });

    it('per-day cap = 0 → check skipped', async () => {
      const { service } = await buildService(
        { liveGuardsEnabled: true, livePerOrderNotionalUsd: 50_000, livePerDayNotionalUsd: 0 },
        createMockRedis(),
        createMockDb([{ qty: null, amount: '999999', price: null }]),
      );
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '1' }],
        }),
      ).resolves.toMatchObject({ reservedCents: expect.any(Number) });
    });

    it('on overshoot, rolls back the reservation (counter ends at pre-attempt value)', async () => {
      const redis = createMockRedis();
      const { service } = await buildService(
        { liveGuardsEnabled: true, livePerOrderNotionalUsd: 50_000, livePerDayNotionalUsd: 10_000 },
        redis,
        createMockDb([{ qty: null, amount: '5000', price: null }]),
      );

      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '6000' }],
        }),
      ).rejects.toThrow(/Per-day notional cap would be exceeded/);

      // Counter should reflect ONLY the seed (5000.00 = 500_000 cents), not
      // the 6000 attempted reservation. The attempted reserve was rolled
      // back via the second INCRBY(-).
      const dayKey = Object.keys(redis._store).find((k) => k.startsWith('trading:daily_cents:'))!;
      expect(Number(redis._store[dayKey])).toBe(500_000);
    });

    it('subsequent successful preflight after a rejected one accumulates correctly', async () => {
      const redis = createMockRedis();
      const db = createMockDb([{ qty: null, amount: '5000', price: null }]);
      const { service } = await buildService(
        { liveGuardsEnabled: true, livePerOrderNotionalUsd: 50_000, livePerDayNotionalUsd: 10_000 },
        redis,
        db,
      );

      // First attempt: $6k → would push total to $11k → reject + rollback.
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '6000' }],
        }),
      ).rejects.toThrow(/Per-day notional cap/);

      // Second attempt: $4k → total $9k ≤ $10k → allowed.
      // (The per-day query is NOT re-run because the counter key already
      // exists; this confirms the rollback restored the right amount.)
      await expect(
        service.preflight({
          userId: TEST_USER,
          operations: [{ symbol: 'AAPL', action: 'BUY', amount: '4000' }],
        }),
      ).resolves.toMatchObject({ reservedCents: expect.any(Number) });

      // Counter is now $5k seed + $4k accepted = $9k = 900_000 cents.
      const dayKey = Object.keys(redis._store).find((k) => k.startsWith('trading:daily_cents:'))!;
      expect(Number(redis._store[dayKey])).toBe(900_000);
    });

    it('per-day SELECT only runs ONCE per day (steady-state cost = 1 INCRBY)', async () => {
      const redis = createMockRedis();
      const db = createMockDb([{ qty: null, amount: '1000', price: null }]);
      const { service } = await buildService(
        { liveGuardsEnabled: true, livePerOrderNotionalUsd: 50_000, livePerDayNotionalUsd: 50_000 },
        redis,
        db,
      );

      await service.preflight({
        userId: TEST_USER,
        operations: [{ symbol: 'AAPL', action: 'BUY', amount: '100' }],
      });
      await service.preflight({
        userId: TEST_USER,
        operations: [{ symbol: 'AAPL', action: 'BUY', amount: '100' }],
      });
      await service.preflight({
        userId: TEST_USER,
        operations: [{ symbol: 'AAPL', action: 'BUY', amount: '100' }],
      });

      // The DB SELECT was called exactly once (first request seeds; the
      // next two requests skipped the seed because the counter key existed).
      expect(db.select).toHaveBeenCalledTimes(1);
      // Each preflight ran exactly one INCRBY for the increment (no
      // rollback INCRBYs because all three were accepted).
      expect(redis.incrby).toHaveBeenCalledTimes(3);
    });
  });

  describe('rollbackDailyReservation + proposedCentsFor (broker-failure path)', () => {
    it('rollbackDailyReservation decrements the counter by the given cents', async () => {
      const redis = createMockRedis();
      const { service } = await buildService(undefined, redis);

      // Seed the counter
      const utcDay = new Date().toISOString().slice(0, 10);
      const counterKey = `trading:daily_cents:${TEST_USER}:${utcDay}`;
      redis._store[counterKey] = '500_000';
      // setting via mock incrby to avoid leading zeros confusion
      redis._store[counterKey] = '500000';

      await service.rollbackDailyReservation(TEST_USER, 100_000);
      expect(Number(redis._store[counterKey])).toBe(400_000);
    });

    it('rollbackDailyReservation is a no-op for proposedCents <= 0', async () => {
      const redis = createMockRedis();
      const { service } = await buildService(undefined, redis);
      await service.rollbackDailyReservation(TEST_USER, 0);
      await service.rollbackDailyReservation(TEST_USER, -100);
      expect(redis.incrby).not.toHaveBeenCalled();
    });

    it('proposedCentsFor sums and converts to integer cents', async () => {
      const { service } = await buildService();
      expect(
        service.proposedCentsFor([
          { symbol: 'A', action: 'BUY', amount: '100.50' },
          { symbol: 'B', action: 'BUY', amount: '50.25' },
        ]),
      ).toBe(15_075); // $150.75 = 15075 cents
    });

    it('proposedCentsFor handles unpriceable ops by skipping them (caller is expected to fail-closed earlier)', async () => {
      const { service } = await buildService();
      // qty without indicativePrice → unpriceable, skipped
      expect(
        service.proposedCentsFor([
          { symbol: 'A', action: 'BUY', qty: '10' },
          { symbol: 'B', action: 'BUY', amount: '50' },
        ]),
      ).toBe(5_000); // Only the $50 priceable op contributes
    });
  });
});
