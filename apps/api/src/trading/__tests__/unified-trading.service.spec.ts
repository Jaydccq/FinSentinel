import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnifiedTradingService } from '../unified-trading.service';
import { BrokerRegistry } from '../broker-registry.service';
import { OrderLedgerService } from '../order-ledger/order-ledger.service';
import { TradingGuardsService } from '../guards/trading-guards.service';
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
          provide: TradingGuardsService,
          useValue: {
            // Default for these tests: guard is a no-op (flag-off equivalent).
            preflight: vi.fn().mockResolvedValue(undefined),
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
                  liveGuardsEnabled: false,
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

  // ─────────────────────────────────────────────────────────────────────────
  // Item 3 M2 — state machine flag-on coverage (TRADING_STATE_MACHINE_ENABLED)
  // ─────────────────────────────────────────────────────────────────────────
  describe('execute (TRADING_STATE_MACHINE_ENABLED=true)', () => {
    let stateMachineService: UnifiedTradingService;
    let stateMachineLedger: {
      recordExecutionResults: ReturnType<typeof vi.fn>;
      findByIdempotency: ReturnType<typeof vi.fn>;
      findByCommitHash: ReturnType<typeof vi.fn>;
      recordExecuting: ReturnType<typeof vi.fn>;
      transitionFromExecuting: ReturnType<typeof vi.fn>;
      transitionAll: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      stateMachineLedger = {
        recordExecutionResults: vi.fn().mockResolvedValue(undefined),
        findByIdempotency: vi.fn().mockResolvedValue([]),
        findByCommitHash: vi.fn().mockResolvedValue([]),
        recordExecuting: vi
          .fn()
          .mockImplementation(async (input: { operations: unknown[] }) =>
            input.operations.map((_o, i) => `row-${i}`),
          ),
        transitionFromExecuting: vi.fn().mockResolvedValue(undefined),
        transitionAll: vi.fn().mockResolvedValue(undefined),
      };

      const module = await Test.createTestingModule({
        providers: [
          UnifiedTradingService,
          { provide: BrokerRegistry, useValue: brokerRegistry },
          { provide: 'REDIS', useValue: mockRedis },
          { provide: 'DRIZZLE_DB', useValue: mockDb },
          { provide: 'MarketDataService', useValue: mockMarketData },
          { provide: OrderLedgerService, useValue: stateMachineLedger },
          {
            provide: TradingGuardsService,
            useValue: { preflight: vi.fn().mockResolvedValue(undefined) },
          },
          {
            provide: ConfigService,
            useValue: {
              get: <T>(key: string): T | undefined => {
                if (key === 'trading') {
                  return {
                    decimalExecuteEnabled: false,
                    stateMachineEnabled: true,
                  } as unknown as T;
                }
                return undefined;
              },
            },
          },
        ],
      }).compile();

      stateMachineService = module.get(UnifiedTradingService);
    });

    const pendingCommit = {
      hash: 'sm123abc'.padEnd(64, '0'),
      message: 'SM Buy AAPL',
      timestamp: new Date().toISOString(),
      operations: [
        { action: 'BUY', symbol: 'AAPL', qty: '10' },
        { action: 'BUY', symbol: 'TSLA', qty: '5' },
      ],
    };

    /** Wire flag-on Redis: GET returns the pending payload, no GETDEL. */
    function primePendingForFlagOn(payload: unknown) {
      (mockRedis.get as Mock).mockImplementation(async (key: string) => {
        if (key === `uta:pending:${TEST_USER_ID}`) return JSON.stringify(payload);
        return null;
      });
    }

    function primeWallet(commitHistory: unknown[] = []) {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          id: TEST_WALLET_ID,
          userId: TEST_USER_ID,
          initialCapital: '100000.00',
          cashBalance: '100000.00',
          tradingMode: 'PAPER',
          positions: [],
          commitHistory,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    }

    it('flag-on uses GET (not GETDEL) to read pending — durable-first ordering', async () => {
      primePendingForFlagOn(pendingCommit);
      primeWallet();

      await stateMachineService.execute(TEST_USER_ID);

      // GETDEL must NOT be called on flag-on path
      expect(mockRedis.getdel).not.toHaveBeenCalled();
      // GET on the pending key was called instead
      expect(mockRedis.get).toHaveBeenCalledWith(`uta:pending:${TEST_USER_ID}`);
    });

    it('inserts EXECUTING rows BEFORE deleting pending and transitions them after broker', async () => {
      const callOrder: string[] = [];
      stateMachineLedger.recordExecuting.mockImplementation(async (input: { operations: unknown[] }) => {
        callOrder.push('recordExecuting');
        return input.operations.map((_o, i) => `row-${i}`);
      });
      (mockRedis.del as Mock).mockImplementation(async () => {
        callOrder.push('del-pending');
        return 1;
      });
      stateMachineLedger.transitionFromExecuting.mockImplementation(async () => {
        callOrder.push('transitionFromExecuting');
      });

      primePendingForFlagOn(pendingCommit);
      primeWallet();

      await stateMachineService.execute(TEST_USER_ID);

      // Ordering invariant: durable record (recordExecuting) BEFORE pending DEL,
      // and transition AFTER broker (which sits between the DEL and transition).
      expect(callOrder).toEqual(['recordExecuting', 'del-pending', 'transitionFromExecuting']);

      const [rowIds, outcomes] = stateMachineLedger.transitionFromExecuting.mock.calls[0]!;
      expect(rowIds).toEqual(['row-0', 'row-1']);
      expect(outcomes).toHaveLength(2);

      // Legacy dual-write must NOT have run when flag on.
      expect(stateMachineLedger.recordExecutionResults).not.toHaveBeenCalled();

      // Wallet was updated, but commitHistory must NOT have been included.
      expect(mockDb.update).toHaveBeenCalled();
      const updateSetArg = mockDb._updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(updateSetArg).not.toHaveProperty('commitHistory');
      expect(updateSetArg).toHaveProperty('cashBalance');
      expect(updateSetArg).toHaveProperty('positions');
    });

    it('rejects with 409 when EXECUTING/terminal rows exist for the same (user, commit_hash)', async () => {
      // Simulate a crashed prior attempt that left EXECUTING rows behind.
      stateMachineLedger.findByCommitHash.mockResolvedValueOnce([
        { id: 'r1', userId: TEST_USER_ID, status: 'EXECUTING' },
      ]);

      primePendingForFlagOn(pendingCommit);
      primeWallet();

      await expect(stateMachineService.execute(TEST_USER_ID)).rejects.toThrow(
        /ledger row.*status=EXECUTING.*refusing to re-execute/,
      );

      // Did not insert new rows or DEL pending — pending stays for the
      // reconciler / operator to investigate.
      expect(stateMachineLedger.recordExecuting).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('per-(user, hash) check ignores other users with the same hash', async () => {
      // Another user happens to have a row with the same commit_hash; ours must proceed.
      stateMachineLedger.findByCommitHash.mockResolvedValueOnce([
        { id: 'other', userId: 'someone-else', status: 'EXECUTED' },
      ]);

      primePendingForFlagOn(pendingCommit);
      primeWallet();

      await expect(stateMachineService.execute(TEST_USER_ID)).resolves.toBeDefined();
      expect(stateMachineLedger.recordExecuting).toHaveBeenCalled();
    });

    it('rejects when ledger has terminal rows for the (user, idempotencyKey) pair', async () => {
      stateMachineLedger.findByIdempotency.mockResolvedValueOnce([
        { id: 'old', status: 'EXECUTED' },
      ]);

      await expect(stateMachineService.execute(TEST_USER_ID, 'IDEM-PRIOR')).rejects.toThrow(
        /already used/,
      );

      // Did not consume the pending commit.
      expect(mockRedis.getdel).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(stateMachineLedger.recordExecuting).not.toHaveBeenCalled();
    });

    it('does NOT consult wallet.commitHistory for hash-idempotency when flag on', async () => {
      primePendingForFlagOn(pendingCommit);
      // Wallet already has this hash in history — flag-off path would 400,
      // but flag-on path ignores commitHistory entirely.
      primeWallet([{ hash: pendingCommit.hash }]);

      await expect(stateMachineService.execute(TEST_USER_ID)).resolves.toBeDefined();
      expect(stateMachineLedger.recordExecuting).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Item 5 live-trading guards — UnifiedTradingService-level integration
  // ─────────────────────────────────────────────────────────────────────────
  // These tests wire the REAL TradingGuardsService against mock Redis/DB so
  // execute()'s LIVE-mode preflight + rollback + qty-enrichment paths run
  // end-to-end. Catches regressions like:
  //   - qty-only ops being passed to preflight without an indicative price
  //     (the "P1 qty bypass" finding from review)
  //   - failed broker calls permanently consuming the daily cap (the "P1
  //     no rollback" finding from review)
  describe('LIVE-mode preflight wiring (item 5 integration — real guards)', () => {
    const liveSymbol = 'AAPL';
    const livePending = {
      hash: 'live123abc'.padEnd(64, '0'),
      message: 'live qty buy',
      timestamp: new Date().toISOString(),
      operations: [{ action: 'BUY', symbol: liveSymbol, qty: '5' }],
    };

    /**
     * Build a UnifiedTradingService with a real TradingGuardsService and
     * a stub broker that we control per test. The wallet is forced into
     * LIVE mode by the spec's primeWallet helper.
     */
    /**
     * Extend the spec's createMockRedis with the methods TradingGuardsService
     * needs (exists / incrby / set with NX flag). Also keeps a backing
     * store so tests can inspect counter values after the fact.
     */
    function createGuardCapableRedis() {
      const base = createMockRedis();
      const store: Record<string, string> = {};
      const richRedis = {
        ...base,
        exists: vi.fn(async (k: string) => (store[k] != null ? 1 : 0)),
        incrby: vi.fn(async (k: string, delta: number) => {
          const cur = store[k] != null ? Number(store[k]) : 0;
          const next = cur + delta;
          store[k] = String(next);
          return next;
        }),
        // Override set/get/del to share the same store so the integration
        // can also exercise the guards' set NX path realistically.
        set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
          const isNx = args.includes('NX');
          if (isNx && store[k] != null) return null;
          store[k] = v;
          return 'OK';
        }),
        get: vi.fn(async (k: string) => store[k] ?? null),
        del: vi.fn(async (k: string) => {
          const had = store[k] != null;
          delete store[k];
          return had ? 1 : 0;
        }),
        _store: store,
      };
      return richRedis;
    }

    async function buildLive(opts: {
      cfg?: Partial<{
        liveGuardsEnabled: boolean;
        livePerOrderNotionalUsd: number;
        livePerDayNotionalUsd: number;
      }>;
      quoteClose?: string | null;
      brokerOutcome?:
        | { kind: 'ok'; filledQty: string; avgPrice: string }
        | { kind: 'fail'; message: string }
        | { kind: 'throw'; error: string };
    }) {
      const cfg = {
        decimalExecuteEnabled: false,
        stateMachineEnabled: false,
        liveGuardsEnabled: true,
        livePerOrderNotionalUsd: 10_000,
        livePerDayNotionalUsd: 50_000,
        ...opts.cfg,
      };

      const localRedis = createGuardCapableRedis();
      const localDb = createMockDb();
      // Two different consumers of `db.select(...).from().where(...)`:
      //   - Wallet load: continues with `.limit(1)` then awaits (terminal = limit)
      //   - Guards seed: awaits the where() directly (terminal = where, returns [])
      // Default mockReturnThis on where breaks the second case (resolves
      // to the chain, not an array). Make the chain itself a thenable that
      // resolves to [] so `await chain` returns [], while still supporting
      // `.limit()` for the wallet path.
      const chain = localDb._selectChain as Record<string, unknown>;
      chain['then'] = (resolve: (v: unknown) => void) => resolve([]);

      // Wire the real guards service so the integration covers preflight,
      // proposedCentsFor, and rollbackDailyReservation as a unit.
      const realGuards = new TradingGuardsService(
        localRedis as unknown as Parameters<typeof TradingGuardsService>[0],
        localDb as unknown as Parameters<typeof TradingGuardsService>[1],
        {
          get: <T>(key: string): T | undefined =>
            key === 'trading' ? (cfg as unknown as T) : undefined,
        } as ConfigService,
      );

      const mockBroker = {
        placeOrder: vi.fn().mockImplementation(async () => {
          const o = opts.brokerOutcome ?? { kind: 'ok', filledQty: '5', avgPrice: '150' };
          if (o.kind === 'throw') throw new Error(o.error);
          if (o.kind === 'fail') {
            return {
              success: false,
              orderId: '',
              status: 'rejected',
              filledQty: '0',
              avgPrice: '0',
              errorMessage: o.message,
              timestamp: new Date().toISOString(),
            };
          }
          return {
            success: true,
            orderId: 'broker-order-1',
            status: 'filled',
            filledQty: o.filledQty,
            avgPrice: o.avgPrice,
            errorMessage: null,
            timestamp: new Date().toISOString(),
          };
        }),
      };
      const liveBrokerRegistry = {
        resolve: vi.fn().mockReturnValue(mockBroker),
      };

      const localMarketData = createMockMarketDataService();
      // Override the quote close so we can probe the qty-enrichment path.
      if (opts.quoteClose === null) {
        (localMarketData.getQuote as Mock).mockRejectedValue(new Error('quote outage'));
      } else if (opts.quoteClose) {
        (localMarketData.getQuote as Mock).mockResolvedValue({
          ticker: liveSymbol,
          open: opts.quoteClose,
          high: opts.quoteClose,
          low: opts.quoteClose,
          close: opts.quoteClose,
          volume: 0,
          timestamp: Date.now(),
        });
      }

      const module = await Test.createTestingModule({
        providers: [
          UnifiedTradingService,
          { provide: BrokerRegistry, useValue: liveBrokerRegistry },
          { provide: 'REDIS', useValue: localRedis },
          { provide: 'DRIZZLE_DB', useValue: localDb },
          { provide: 'MarketDataService', useValue: localMarketData },
          {
            provide: OrderLedgerService,
            useValue: {
              recordExecutionResults: vi.fn().mockResolvedValue(undefined),
              findByIdempotency: vi.fn().mockResolvedValue([]),
              findByCommitHash: vi.fn().mockResolvedValue([]),
            },
          },
          { provide: TradingGuardsService, useValue: realGuards },
          {
            provide: ConfigService,
            useValue: {
              get: <T>(key: string): T | undefined =>
                key === 'trading' ? (cfg as unknown as T) : undefined,
            },
          },
        ],
      }).compile();

      const service = module.get(UnifiedTradingService);
      return { service, realGuards, localRedis, localDb, mockBroker };
    }

    function primeLiveWallet(localDb: ReturnType<typeof createMockDb>) {
      localDb._selectChain.limit.mockResolvedValue([
        {
          id: TEST_WALLET_ID,
          userId: TEST_USER_ID,
          initialCapital: '100000.00',
          cashBalance: '100000.00',
          tradingMode: 'LIVE',
          positions: [],
          commitHistory: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    }

    it('qty-only op gets quoted and PASSES preflight when notional ≤ caps (P1 qty bypass fix)', async () => {
      const built = await buildLive({
        quoteClose: '100', // 5 * 100 = $500 notional, well under $10k cap
        brokerOutcome: { kind: 'ok', filledQty: '5', avgPrice: '100' },
      });
      built.localRedis.getdel.mockResolvedValue(JSON.stringify(livePending));
      primeLiveWallet(built.localDb);

      await expect(built.service.execute(TEST_USER_ID)).resolves.toBeDefined();

      // Broker was called (preflight passed)
      expect(built.mockBroker.placeOrder).toHaveBeenCalledTimes(1);
      // Daily counter ended up at exactly 50000 cents = $500 (one fill at intent)
      const dayKey = Object.keys(built.localRedis._store).find((k) =>
        k.startsWith('trading:daily_cents:'),
      );
      expect(dayKey).toBeDefined();
      expect(Number(built.localRedis._store[dayKey!])).toBe(50_000);
    });

    it('qty-only op without a quote (market data outage) BLOCKS at preflight, no broker call', async () => {
      const built = await buildLive({
        quoteClose: null, // getQuote will throw
      });
      built.localRedis.getdel.mockResolvedValue(JSON.stringify(livePending));
      primeLiveWallet(built.localDb);

      await expect(built.service.execute(TEST_USER_ID)).rejects.toThrow(
        /Cannot determine notional/,
      );
      expect(built.mockBroker.placeOrder).not.toHaveBeenCalled();
    });

    it('failed broker order rolls back the daily-cap reservation (P1 no-rollback fix)', async () => {
      const built = await buildLive({
        quoteClose: '100', // proposed = $500 = 50_000 cents
        brokerOutcome: { kind: 'fail', message: 'broker rejected: insufficient buying power' },
      });
      built.localRedis.getdel.mockResolvedValue(JSON.stringify(livePending));
      primeLiveWallet(built.localDb);

      await built.service.execute(TEST_USER_ID);

      // Reservation should be rolled back to 0 since the order didn't fill.
      const dayKey = Object.keys(built.localRedis._store).find((k) =>
        k.startsWith('trading:daily_cents:'),
      );
      expect(dayKey).toBeDefined();
      expect(Number(built.localRedis._store[dayKey!])).toBe(0);
    });

    it('partial fill rolls back ONLY the unfilled portion', async () => {
      const built = await buildLive({
        quoteClose: '100', // proposed = 5 * 100 = $500 = 50_000 cents
        brokerOutcome: { kind: 'ok', filledQty: '3', avgPrice: '100' }, // realized = $300 = 30_000
      });
      built.localRedis.getdel.mockResolvedValue(JSON.stringify(livePending));
      primeLiveWallet(built.localDb);

      await built.service.execute(TEST_USER_ID);

      const dayKey = Object.keys(built.localRedis._store).find((k) =>
        k.startsWith('trading:daily_cents:'),
      );
      // Daily counter = realized 30_000, NOT proposed 50_000.
      expect(Number(built.localRedis._store[dayKey!])).toBe(30_000);
    });

    it('broker throws → rollback to zero (whole reservation refunded)', async () => {
      const built = await buildLive({
        quoteClose: '100',
        brokerOutcome: { kind: 'throw', error: 'broker timeout' },
      });
      built.localRedis.getdel.mockResolvedValue(JSON.stringify(livePending));
      primeLiveWallet(built.localDb);

      await built.service.execute(TEST_USER_ID);

      const dayKey = Object.keys(built.localRedis._store).find((k) =>
        k.startsWith('trading:daily_cents:'),
      );
      expect(Number(built.localRedis._store[dayKey!])).toBe(0);
    });

    it('per-order cap breach throws BEFORE broker call (proposed > $10k limit)', async () => {
      const built = await buildLive({
        quoteClose: '5000', // 5 * 5000 = $25k > $10k per-order cap
      });
      built.localRedis.getdel.mockResolvedValue(JSON.stringify(livePending));
      primeLiveWallet(built.localDb);

      await expect(built.service.execute(TEST_USER_ID)).rejects.toThrow(
        /Per-order notional cap exceeded/,
      );
      expect(built.mockBroker.placeOrder).not.toHaveBeenCalled();
    });
  });
});
