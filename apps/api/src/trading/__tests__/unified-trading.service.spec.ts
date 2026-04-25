import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnifiedTradingService } from '../unified-trading.service';
import { BrokerRegistry } from '../broker-registry.service';
import { OrderLedgerService } from '../order-ledger/order-ledger.service';
import type { MarketDataService } from '../../market/market-data.service';
import { TradingMode, Contract } from '@finsentinel/shared';

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_WALLET_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Minimal mock Redis matching ioredis interface.
 * We only need get/set/del/eval/expire.
 */
function createMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    getdel: vi.fn().mockResolvedValue(null),
    eval: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
}

/**
 * Mock Drizzle DB with chainable select/insert/update.
 */
function createMockDb() {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: TEST_WALLET_ID,
        userId: TEST_USER_ID,
        initialCapital: '100000.00',
        cashBalance: '100000.00',
        tradingMode: 'PAPER',
        positions: [],
        commitHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: TEST_WALLET_ID,
        userId: TEST_USER_ID,
        initialCapital: '100000.00',
        cashBalance: '100000.00',
        tradingMode: 'PAPER',
        positions: [],
        commitHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
    _updateChain: updateChain,
  };
}

function createMockMarketDataService(): MarketDataService {
  return {
    getQuote: vi.fn().mockResolvedValue({
      ticker: 'AAPL',
      open: '150.00',
      high: '155.00',
      low: '149.00',
      close: '150.00',
      volume: 50000000,
      timestamp: Date.now(),
    }),
    getHistoricalBars: vi.fn(),
    searchTickers: vi
      .fn()
      .mockResolvedValue([
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY' },
      ]),
  } as unknown as MarketDataService;
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('UnifiedTradingService', () => {
  let service: UnifiedTradingService;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockMarketData: MarketDataService;
  let brokerRegistry: BrokerRegistry;

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockDb = createMockDb();
    mockMarketData = createMockMarketDataService();

    brokerRegistry = new BrokerRegistry(
      mockMarketData,
      {
        enabled: false,
        apiKey: '',
        secretKey: '',
        baseUrl: '',
      },
      null,
    );

    const module = await Test.createTestingModule({
      providers: [
        UnifiedTradingService,
        {
          provide: BrokerRegistry,
          useValue: brokerRegistry,
        },
        {
          provide: 'REDIS',
          useValue: mockRedis,
        },
        {
          provide: 'DRIZZLE_DB',
          useValue: mockDb,
        },
        {
          provide: 'MarketDataService',
          useValue: mockMarketData,
        },
        {
          provide: OrderLedgerService,
          useValue: {
            recordExecutionResults: vi.fn().mockResolvedValue(undefined),
            findByIdempotency: vi.fn().mockResolvedValue([]),
            findByCommitHash: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string): T | undefined => {
              if (key === 'trading') {
                return {
                  decimalExecuteEnabled: false,
                  stateMachineEnabled: false,
                } as unknown as T;
              }
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get(UnifiedTradingService);
  });

  // ── Phase 1: Stage ──────────────────────────────────────────────────────

  describe('stage', () => {
    it('adds operation to Redis staging area and returns count', async () => {
      // Lua eval returns the new count (1 after first add)
      mockRedis.eval.mockResolvedValue(1);

      const result = await service.stage(TEST_USER_ID, {
        action: 'BUY',
        symbol: 'AAPL',
        qty: '10',
      });

      expect(result).toBe(1);
      // Verify eval was called with the Lua script
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      const evalCall = (mockRedis.eval as Mock).mock.calls[0]!;
      // First arg is the Lua script, then key count, keys, args...
      expect(evalCall[0]).toContain('cjson.decode');
      expect(evalCall[2]).toBe(`uta:staging:${TEST_USER_ID}`);
    });

    it('rejects when staging area is full (>50)', async () => {
      // Lua script returns -1 when full
      mockRedis.eval.mockResolvedValue(-1);

      await expect(
        service.stage(TEST_USER_ID, {
          action: 'BUY',
          symbol: 'AAPL',
          qty: '10',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStagingArea', () => {
    it('returns empty array when no staging data', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getStagingArea(TEST_USER_ID);

      expect(result).toEqual([]);
    });

    it('parses JSON from Redis', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '10' }];
      mockRedis.get.mockResolvedValue(JSON.stringify(ops));

      const result = await service.getStagingArea(TEST_USER_ID);

      expect(result).toEqual(ops);
    });
  });

  describe('clearStagingArea', () => {
    it('deletes the Redis key', async () => {
      await service.clearStagingArea(TEST_USER_ID);

      expect(mockRedis.del).toHaveBeenCalledWith(`uta:staging:${TEST_USER_ID}`);
    });
  });

  // ── Phase 2: Commit ─────────────────────────────────────────────────────

  describe('commit', () => {
    /**
     * Helper: configure mockRedis.eval so that the LUA_ATOMIC_COMMIT call
     * (1 KEY, 0 ARGV) returns the desired staging payload, while the
     * LUA_ATOMIC_APPEND call (used by stage()) keeps its default behavior.
     */
    function whenAtomicCommitReturns(stagingJson: string | null) {
      (mockRedis.eval as Mock).mockImplementation(
        async (script: string, _numKeys: number, ..._args: string[]) => {
          if (
            typeof script === 'string' &&
            script.includes("redis.call('GET'") &&
            !script.includes('cjson.decode')
          ) {
            return stagingJson;
          }
          return 1; // default for stage's append script
        },
      );
    }

    it('generates SHA-256 hash, stores pending commit, atomically clears staging via Lua', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '10' }];
      whenAtomicCommitReturns(JSON.stringify(ops));

      const result = await service.commit(TEST_USER_ID, 'Buy some AAPL');

      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64); // SHA-256 hex = 64 chars
      expect(result.count).toBe(1);

      // Pending commit written via setex
      expect(mockRedis.setex).toHaveBeenCalled();
      const setexCall = (mockRedis.setex as Mock).mock.calls[0]!;
      expect(setexCall[0]).toBe(`uta:pending:${TEST_USER_ID}`);
      expect(setexCall[1]).toBe(30 * 60); // STATE_TTL_SECONDS
      const storedCommit = JSON.parse(setexCall[2] as string);
      expect(storedCommit.hash).toBe(result.hash);
      expect(storedCommit.message).toBe('Buy some AAPL');
      expect(storedCommit.operations).toEqual(ops);

      // Lua script handled the staging deletion atomically; no separate `del` for staging.
      const delForStaging = (mockRedis.del as Mock).mock.calls.filter(
        (c) => c[0] === `uta:staging:${TEST_USER_ID}`,
      );
      expect(delForStaging.length).toBe(0);
    });

    it('rejects empty staging', async () => {
      whenAtomicCommitReturns(null);

      await expect(service.commit(TEST_USER_ID, 'Empty commit')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects empty staging array', async () => {
      whenAtomicCommitReturns(JSON.stringify([]));

      await expect(service.commit(TEST_USER_ID, 'Empty commit')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects blank message', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '10' }];
      whenAtomicCommitReturns(JSON.stringify(ops));

      await expect(service.commit(TEST_USER_ID, '')).rejects.toThrow(BadRequestException);

      await expect(service.commit(TEST_USER_ID, '   ')).rejects.toThrow(BadRequestException);
    });

    it('persists ledger metadata on the pending commit payload when provided', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '10' }];
      whenAtomicCommitReturns(JSON.stringify(ops));
      const runId = 'run-99999';

      await service.commit(TEST_USER_ID, `analysis run ${runId}`, { ledgerId: 'ledger-1', runId });

      const calls = (
        mockRedis.setex as unknown as { mock: { calls: Array<[string, number, string]> } }
      ).mock.calls;
      const last = calls[calls.length - 1]!;
      expect(last[2]).toContain('"ledgerId":"ledger-1"');
      expect(last[2]).toContain(`"runId":"${runId}"`);
    });

    it('omits metadata from the pending commit payload when not provided', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '10' }];
      whenAtomicCommitReturns(JSON.stringify(ops));

      await service.commit(TEST_USER_ID, 'no-metadata commit');

      const calls = (
        mockRedis.setex as unknown as { mock: { calls: Array<[string, number, string]> } }
      ).mock.calls;
      const last = calls[calls.length - 1]!;
      const payload = JSON.parse(last[2]);
      expect(payload.metadata).toBeUndefined();
    });

    it('returns deterministic hash for same ops + same message (no timestamp in hash input)', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '10' }];
      whenAtomicCommitReturns(JSON.stringify(ops));

      const a = await service.commit(TEST_USER_ID, 'msg');
      // Re-arm staging for second commit
      whenAtomicCommitReturns(JSON.stringify(ops));
      const b = await service.commit(TEST_USER_ID, 'msg');

      expect(b.hash).toBe(a.hash);
    });

    it('returns prior hash when same idempotencyKey is reused (no second pending write)', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '1' }];
      whenAtomicCommitReturns(JSON.stringify(ops));

      // First commit succeeds and caches the idem→hash mapping.
      const cached: Record<string, string> = {};
      (mockRedis.get as Mock).mockImplementation(async (k: string) => cached[k] ?? null);
      (mockRedis.setex as Mock).mockImplementation(async (k: string, _ttl: number, v: string) => {
        cached[k] = v;
        return 'OK';
      });

      const first = await service.commit(TEST_USER_ID, 'msg', undefined, 'IDK-A');

      // Second commit with same idem key: hits cache, must NOT call eval again.
      const evalCallsBefore = (mockRedis.eval as Mock).mock.calls.length;
      const setexCallsBefore = (mockRedis.setex as Mock).mock.calls.length;
      const second = await service.commit(TEST_USER_ID, 'msg', undefined, 'IDK-A');
      expect(second.hash).toBe(first.hash);
      expect((mockRedis.eval as Mock).mock.calls.length).toBe(evalCallsBefore); // no new eval
      expect((mockRedis.setex as Mock).mock.calls.length).toBe(setexCallsBefore); // no new pending write
    });

    it('different idempotencyKey produces different hash', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '1' }];
      whenAtomicCommitReturns(JSON.stringify(ops));
      const a = await service.commit(TEST_USER_ID, 'msg', undefined, 'IDK-A');

      whenAtomicCommitReturns(JSON.stringify(ops));
      const b = await service.commit(TEST_USER_ID, 'msg', undefined, 'IDK-B');

      expect(a.hash).not.toBe(b.hash);
    });
  });

  // ── Phase 3: Execute ────────────────────────────────────────────────────

  describe('execute', () => {
    const pendingCommit = {
      hash: 'abc123def456'.padEnd(64, '0'),
      message: 'Buy AAPL',
      timestamp: new Date().toISOString(),
      operations: [{ action: 'BUY', symbol: 'AAPL', qty: '10' }],
    };

    it('resolves broker, executes operations, persists wallet', async () => {
      // Pending commit exists in Redis (atomic getdel)
      mockRedis.getdel.mockResolvedValue(JSON.stringify(pendingCommit));

      // Wallet exists in DB
      mockDb._selectChain.limit.mockResolvedValue([
        {
          id: TEST_WALLET_ID,
          userId: TEST_USER_ID,
          initialCapital: '100000.00',
          cashBalance: '100000.00',
          tradingMode: 'PAPER',
          positions: [],
          commitHistory: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.execute(TEST_USER_ID);

      expect(result).toBeDefined();
      expect(result.report).toBeDefined();
      expect(result.commitData).toBeDefined();
      expect(result.results).toBeInstanceOf(Array);

      // Should have used atomic getdel (no separate del call for pending)
      expect(mockRedis.getdel).toHaveBeenCalledWith(`uta:pending:${TEST_USER_ID}`);

      // Should have persisted wallet to DB (update)
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('rejects when no pending commit', async () => {
      mockRedis.getdel.mockResolvedValue(null);

      await expect(service.execute(TEST_USER_ID)).rejects.toThrow(BadRequestException);
    });

    it('returns cached ExecuteResult when same Idempotency-Key is reused (no broker re-trigger)', async () => {
      const cachedResult = {
        report: 'cached report',
        commitData: pendingCommit,
        results: [{ symbol: 'AAPL', action: 'BUY', success: true }],
      };

      // Simulate prior execute populated the exec cache.
      (mockRedis.get as Mock).mockImplementation(async (k: string) => {
        if (k === `uta:executed:${TEST_USER_ID}:IDK-EXEC`) {
          return JSON.stringify(cachedResult);
        }
        return null;
      });

      const result = await service.execute(TEST_USER_ID, 'IDK-EXEC');

      expect(result).toEqual(cachedResult);
      // Must NOT have touched pending or DB
      expect(mockRedis.getdel).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('prevents double-execution (idempotency check)', async () => {
      // Pending commit exists (atomic getdel)
      mockRedis.getdel.mockResolvedValue(JSON.stringify(pendingCommit));

      // Wallet already has this commit hash in history
      mockDb._selectChain.limit.mockResolvedValue([
        {
          id: TEST_WALLET_ID,
          userId: TEST_USER_ID,
          initialCapital: '100000.00',
          cashBalance: '100000.00',
          tradingMode: 'PAPER',
          positions: [],
          commitHistory: [{ hash: pendingCommit.hash }],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await expect(service.execute(TEST_USER_ID)).rejects.toThrow(BadRequestException);
    });
  });

  // ── Wallet management ───────────────────────────────────────────────────

  describe('getOrCreateWallet', () => {
    it('returns existing wallet', async () => {
      const existingWallet = {
        id: TEST_WALLET_ID,
        userId: TEST_USER_ID,
        initialCapital: '100000.00',
        cashBalance: '95000.00',
        tradingMode: 'PAPER',
        positions: [{ ticker: 'AAPL', shares: 10, avgCost: 150, currentPrice: 155 }],
        commitHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb._selectChain.limit.mockResolvedValue([existingWallet]);

      const wallet = await service.getOrCreateWallet(TEST_USER_ID);

      expect(wallet.id).toBe(TEST_WALLET_ID);
      expect(wallet.cashBalance).toBe('95000.00');
      // Should not have inserted
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('creates $100k wallet if not exists', async () => {
      mockDb._selectChain.limit.mockResolvedValue([]);

      const wallet = await service.getOrCreateWallet(TEST_USER_ID);

      expect(wallet.initialCapital).toBe('100000.00');
      expect(wallet.cashBalance).toBe('100000.00');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('switchMode', () => {
    it('changes trading mode', async () => {
      // Wallet exists
      mockDb._selectChain.limit.mockResolvedValue([
        {
          id: TEST_WALLET_ID,
          userId: TEST_USER_ID,
          initialCapital: '100000.00',
          cashBalance: '100000.00',
          tradingMode: 'PAPER',
          positions: [],
          commitHistory: [],
        },
      ]);

      await service.switchMode(TEST_USER_ID, TradingMode.LIVE);

      expect(mockDb.update).toHaveBeenCalled();
      const setCall = mockDb._updateChain.set.mock.calls[0]![0];
      expect(setCall.tradingMode).toBe('LIVE');
    });
  });

  // ── Read-only queries ───────────────────────────────────────────────────

  describe('getWalletStatus', () => {
    it('returns human-readable wallet status text', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          id: TEST_WALLET_ID,
          userId: TEST_USER_ID,
          initialCapital: '100000.00',
          cashBalance: '95000.00',
          tradingMode: 'PAPER',
          positions: [{ ticker: 'AAPL', shares: 10, avgCost: 150, currentPrice: 155 }],
          commitHistory: [],
        },
      ]);

      const status = await service.getWalletStatus(TEST_USER_ID);

      expect(typeof status).toBe('string');
      expect(status).toContain('95000');
    });
  });

  describe('searchAssets', () => {
    it('delegates to marketDataService.searchTickers', async () => {
      const results = await service.searchAssets(TEST_USER_ID, 'AAPL');

      expect(mockMarketData.searchTickers as Mock).toHaveBeenCalledWith('AAPL');
      expect(results).toBeDefined();
    });
  });

  describe('operational broker resolution', () => {
    it('derives the broker contract from the most recent commit symbol', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          id: TEST_WALLET_ID,
          userId: TEST_USER_ID,
          initialCapital: '100000.00',
          cashBalance: '100000.00',
          tradingMode: 'LIVE',
          positions: [],
          commitHistory: [
            {
              hash: 'recent-commit',
              message: 'Open BTC perp',
              timestamp: new Date().toISOString(),
              operations: [{ symbol: 'BTC-USDT-SWAP', action: 'BUY' }],
            },
          ],
        },
      ]);

      const getMarketClock = vi.fn().mockResolvedValue({
        isOpen: true,
        timestamp: '2026-04-03T20:00:00.000Z',
        nextOpen: null,
        nextClose: null,
      });
      const resolveSpy = vi
        .spyOn(brokerRegistry, 'resolve')
        .mockReturnValue({ getMarketClock } as never);

      await service.checkMarketHours(TEST_USER_ID);

      const contract = resolveSpy.mock.calls[0]?.[0];
      expect(contract).toBeInstanceOf(Contract);
      expect(contract?.toEngineSymbol()).toBe('BTC-USDT-SWAP');
      expect(resolveSpy.mock.calls[0]?.[1]).toBe(TradingMode.LIVE);
      expect(getMarketClock).toHaveBeenCalledOnce();
    });
  });
});
