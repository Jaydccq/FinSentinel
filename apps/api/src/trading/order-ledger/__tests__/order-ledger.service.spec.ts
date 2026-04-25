import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { OrderLedgerService } from '../order-ledger.service';

const TEST_USER = '11111111-1111-1111-1111-111111111111';

function createMockDb() {
  const insertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    insert: vi.fn().mockReturnValue(insertChain),
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
    _insertChain: insertChain,
    _selectChain: selectChain,
    _updateChain: updateChain,
  };
}

describe('OrderLedgerService', () => {
  let service: OrderLedgerService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    const module = await Test.createTestingModule({
      providers: [
        OrderLedgerService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
      ],
    }).compile();
    service = module.get(OrderLedgerService);
  });

  describe('recordExecutionResults', () => {
    it('writes one row per operation, marking success ops EXECUTED', async () => {
      await service.recordExecutionResults({
        userId: TEST_USER,
        commitHash: 'a'.repeat(64),
        idempotencyKey: 'idem-1',
        broker: 'paper',
        operations: [
          {
            symbol: 'AAPL',
            action: 'buy',
            success: true,
            filledQty: '10',
            avgPrice: '150.25',
          },
          {
            symbol: 'TSLA',
            action: 'sell',
            success: true,
            filledQty: '2',
            avgPrice: '900',
          },
        ],
      });

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      const rows = mockDb._insertChain.values.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        userId: TEST_USER,
        commitHash: 'a'.repeat(64),
        idempotencyKey: 'idem-1',
        status: 'EXECUTED',
        symbol: 'AAPL',
        side: 'buy',
        broker: 'paper',
      });
      expect(rows[1]).toMatchObject({
        status: 'EXECUTED',
        symbol: 'TSLA',
        side: 'sell',
      });
    });

    it('marks failed ops FAILED with errorReason', async () => {
      await service.recordExecutionResults({
        userId: TEST_USER,
        commitHash: 'b'.repeat(64),
        broker: 'paper',
        operations: [
          {
            symbol: 'AAPL',
            action: 'buy',
            success: false,
            errorMessage: 'insufficient funds',
          },
        ],
      });

      const rows = mockDb._insertChain.values.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        symbol: 'AAPL',
        side: 'buy',
        errorReason: 'insufficient funds',
        idempotencyKey: null,
      });
      expect(rows[0]!.brokerResponse).toBeNull();
    });

    it('side defaults to buy when action is unknown / unset', async () => {
      await service.recordExecutionResults({
        userId: TEST_USER,
        commitHash: 'c'.repeat(64),
        broker: 'paper',
        operations: [
          { symbol: 'AAPL', action: undefined, success: true },
        ],
      });
      const rows = mockDb._insertChain.values.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(rows[0]!.side).toBe('buy');
    });

    it('treats action="close" as a sell', async () => {
      await service.recordExecutionResults({
        userId: TEST_USER,
        commitHash: 'd'.repeat(64),
        broker: 'alpaca',
        operations: [{ symbol: 'AAPL', action: 'close', success: true }],
      });
      const rows = mockDb._insertChain.values.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(rows[0]!.side).toBe('sell');
      expect(rows[0]!.broker).toBe('alpaca');
    });

    it('no-op when operations is empty (does not call db.insert)', async () => {
      await service.recordExecutionResults({
        userId: TEST_USER,
        commitHash: 'e'.repeat(64),
        broker: 'paper',
        operations: [],
      });
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('serializes qty/amount/price to strings (decimal-money convention)', async () => {
      await service.recordExecutionResults({
        userId: TEST_USER,
        commitHash: 'f'.repeat(64),
        broker: 'paper',
        operations: [
          {
            symbol: 'AAPL',
            action: 'buy',
            success: true,
            qty: '10.5',
            amount: '1500',
            avgPrice: '150.05',
          },
        ],
      });
      const rows = mockDb._insertChain.values.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(rows[0]!.qty).toBe('10.5');
      expect(rows[0]!.amount).toBe('1500');
      expect(rows[0]!.price).toBe('150.05');
    });
  });

  describe('findByIdempotency / findByCommitHash', () => {
    it('returns rows from the select chain', async () => {
      mockDb._selectChain.orderBy.mockResolvedValue([{ id: 'row-1' }]);
      const out = await service.findByIdempotency(TEST_USER, 'idem-1');
      expect(out).toEqual([{ id: 'row-1' }]);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('findByCommitHash queries by commit_hash', async () => {
      mockDb._selectChain.orderBy.mockResolvedValue([{ id: 'row-2' }]);
      const out = await service.findByCommitHash('h'.repeat(64));
      expect(out).toEqual([{ id: 'row-2' }]);
    });
  });

  // ── M2 state machine transitions ────────────────────────────────────────
  describe('recordExecuting / transitionFromExecuting / transitionAll (M2)', () => {
    it('recordExecuting inserts EXECUTING rows and returns ids in input order', async () => {
      const ids = await service.recordExecuting({
        userId: TEST_USER,
        commitHash: 'a'.repeat(64),
        idempotencyKey: 'idem-sm',
        broker: 'paper',
        operations: [
          { symbol: 'AAPL', action: 'buy', qty: '10' },
          { symbol: 'TSLA', action: 'sell', qty: '5' },
        ],
      });
      expect(ids).toHaveLength(2);
      const rows = mockDb._insertChain.values.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(rows[0]).toMatchObject({ status: 'EXECUTING', symbol: 'AAPL', side: 'buy' });
      expect(rows[1]).toMatchObject({ status: 'EXECUTING', symbol: 'TSLA', side: 'sell' });
      expect(rows[0]!.brokerResponse).toBeNull();
      expect(rows[0]!.errorReason).toBeNull();
      expect(ids[0]).toBe(rows[0]!.id);
      expect(ids[1]).toBe(rows[1]!.id);
    });

    it('recordExecuting is a no-op for empty operations (does not call insert)', async () => {
      const ids = await service.recordExecuting({
        userId: TEST_USER,
        commitHash: 'b'.repeat(64),
        broker: 'paper',
        operations: [],
      });
      expect(ids).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('transitionFromExecuting updates each row to EXECUTED or FAILED matching outcomes order', async () => {
      await service.transitionFromExecuting(
        ['row-A', 'row-B'],
        [
          { symbol: 'AAPL', action: 'buy', success: true, filledQty: '10', avgPrice: '150' },
          { symbol: 'TSLA', action: 'sell', success: false, errorMessage: 'broker rejected' },
        ],
      );
      // Two updates, same order
      expect(mockDb.update).toHaveBeenCalledTimes(2);
      const setCall0 = mockDb._updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
      const setCall1 = mockDb._updateChain.set.mock.calls[1]![0] as Record<string, unknown>;
      expect(setCall0).toMatchObject({ status: 'EXECUTED' });
      expect(setCall0.errorReason).toBeNull();
      expect(setCall1).toMatchObject({ status: 'FAILED', errorReason: 'broker rejected' });
      expect(setCall1.brokerResponse).toBeNull();
    });

    it('transitionFromExecuting throws on length mismatch', async () => {
      await expect(
        service.transitionFromExecuting(['row-1'], [
          { symbol: 'A', action: 'buy', success: true },
          { symbol: 'B', action: 'buy', success: true },
        ]),
      ).rejects.toThrow(/length=1.*length=2/);
    });

    it('transitionAll bulk-sets status + errorReason for a list of rows', async () => {
      await service.transitionAll(['r1', 'r2'], 'CANCELLED', 'pre-broker validation failed');
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      const setCall = mockDb._updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall).toMatchObject({
        status: 'CANCELLED',
        errorReason: 'pre-broker validation failed',
      });
    });

    it('transitionAll is a no-op for empty rowIds', async () => {
      await service.transitionAll([], 'FAILED', 'never reached');
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
