import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import IORedis from 'ioredis';
import { UnifiedTradingService } from '../unified-trading.service';
import type { BrokerRegistry } from '../broker-registry.service';
import type { MarketDataService } from '../../market/market-data.service';
import { TradingMode } from '@finsentinel/shared';

const TEST_USER = '99999999-9999-9999-9999-999999999999';

/**
 * Integration spec — exercises the real Lua scripts against a live Redis on
 * 127.0.0.1:6379 (the docker-compose `redis` service). Drizzle DB is mocked
 * with an in-memory wallet store so we don't depend on Postgres for this
 * narrow surface.
 *
 * Skips automatically if Redis is unreachable, so this file does not break
 * environments without docker.
 */

let redisAvailable = true;

async function isRedisUp(): Promise<boolean> {
  const probe = new IORedis({
    host: '127.0.0.1',
    port: 6379,
    lazyConnect: true,
    connectTimeout: 500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    try { await probe.disconnect(); } catch { /* swallow */ }
    return false;
  }
}

describe('UnifiedTradingService integration (real Redis)', () => {
  let redis: IORedis;
  let svc: UnifiedTradingService;
  let placeOrder: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    redisAvailable = await isRedisUp();
    if (!redisAvailable) {
      console.warn('Redis not reachable on 127.0.0.1:6379 — skipping trading integration tests');
      return;
    }
    redis = new IORedis({ host: '127.0.0.1', port: 6379, lazyConnect: false });
    await redis.ping();
  });

  afterAll(async () => {
    if (redisAvailable && redis) await redis.quit();
  });

  beforeEach(async () => {
    if (!redisAvailable) return;

    const keys = await redis.keys('uta:*' + TEST_USER + '*');
    if (keys.length) await redis.del(...keys);

    placeOrder = vi.fn().mockResolvedValue({
      success: true,
      filledQty: '1',
      avgPrice: '100',
    });

    let wallet = {
      id: 'integration-wallet',
      userId: TEST_USER,
      initialCapital: '100000.00',
      cashBalance: '100000.00',
      tradingMode: TradingMode.PAPER,
      positions: [] as unknown[],
      commitHistory: [] as unknown[],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([wallet]) }),
        }),
      }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([wallet]) }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => {
            wallet = { ...wallet, ...patch };
            return Promise.resolve();
          },
        }),
      }),
    } as unknown as Parameters<typeof UnifiedTradingService>[0]; // any-ish

    const brokerRegistry = {
      resolve: () => ({
        placeOrder,
        engine: () => ({
          setCash: vi.fn(),
          setPositions: vi.fn(),
          getCash: () => 99900,
          getPositionMaps: () => [],
        }),
      }),
    } as unknown as BrokerRegistry;

    const marketDataService = {
      searchTickers: vi.fn(),
    } as unknown as MarketDataService;

    svc = new UnifiedTradingService(
      brokerRegistry,
      redis as unknown as IORedis,
      db as never,
      marketDataService,
    );
  });

  afterEach(async () => {
    if (!redisAvailable || !redis) return;
    const keys = await redis.keys('uta:*' + TEST_USER + '*');
    if (keys.length) await redis.del(...keys);
  });

  it('end-to-end stage → commit → execute → re-execute returns cached result', async () => {
    if (!redisAvailable) return;

    await svc.stage(TEST_USER, { action: 'BUY', symbol: 'AAPL', qty: '1' });
    const c1 = await svc.commit(TEST_USER, 'first', undefined, 'IT-1');
    expect(c1.hash).toMatch(/^[0-9a-f]{64}$/);

    const e1 = await svc.execute(TEST_USER, 'IT-1');
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(e1.report).toContain(c1.hash.substring(0, 8));

    // Re-execute with same key: cache hit, no broker re-call.
    const e2 = await svc.execute(TEST_USER, 'IT-1');
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(e2.report).toBe(e1.report);
  });

  it('idempotent commit: stage → commit(K) → stage → commit(K) → same hash, no second pending write', async () => {
    if (!redisAvailable) return;

    await svc.stage(TEST_USER, { action: 'BUY', symbol: 'AAPL', qty: '1' });
    const a = await svc.commit(TEST_USER, 'msg', undefined, 'IT-2');

    await svc.stage(TEST_USER, { action: 'BUY', symbol: 'AAPL', qty: '1' });
    const b = await svc.commit(TEST_USER, 'msg', undefined, 'IT-2');

    expect(b.hash).toBe(a.hash);

    // After idempotent hit, staging must still hold the second BUY (it was not promoted).
    const stagedRaw = await redis.get('uta:staging:' + TEST_USER);
    expect(stagedRaw).not.toBeNull();
    const staged = JSON.parse(stagedRaw as string);
    expect(staged).toHaveLength(1);
  });

  it('different idempotencyKey produces a different hash', async () => {
    if (!redisAvailable) return;

    await svc.stage(TEST_USER, { action: 'BUY', symbol: 'AAPL', qty: '1' });
    const a = await svc.commit(TEST_USER, 'msg', undefined, 'IT-A');

    await svc.stage(TEST_USER, { action: 'BUY', symbol: 'AAPL', qty: '1' });
    const b = await svc.commit(TEST_USER, 'msg', undefined, 'IT-B');

    expect(a.hash).not.toBe(b.hash);
  });
});
