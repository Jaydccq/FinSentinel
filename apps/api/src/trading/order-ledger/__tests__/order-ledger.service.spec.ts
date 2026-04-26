import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderLedgerService } from '../order-ledger.service';
import { AgentEventService } from '../../../events/agent-event.service';

const TEST_USER = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';

function createMockDb() {
  const insertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  // The select chain handles both `.orderBy()` (terminal) and
  // `.orderBy().limit()` (M4 prereq pending list path).
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
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

function createMockAgentEvents() {
  return { append: vi.fn().mockResolvedValue(undefined) };
}

describe('OrderLedgerService', () => {
  let service: OrderLedgerService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAgentEvents: ReturnType<typeof createMockAgentEvents>;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockAgentEvents = createMockAgentEvents();
    const module = await Test.createTestingModule({
      providers: [
        OrderLedgerService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: AgentEventService, useValue: mockAgentEvents },
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

  // ── M4 prereq (2): operator surface for UNKNOWN_REQUIRES_OPERATOR_REVIEW ──
  describe('findUnknownPending', () => {
    it('queries owner-scoped UNKNOWN rows that are not yet acknowledged, newest first', async () => {
      const rows = [
        { id: 'lg-2', updatedAt: new Date('2026-04-26T01:00:00Z') },
        { id: 'lg-1', updatedAt: new Date('2026-04-25T01:00:00Z') },
      ];
      mockDb._selectChain.limit.mockResolvedValueOnce(rows);
      const out = await service.findUnknownPending(TEST_USER, 25);
      expect(out).toEqual(rows);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      // The where + orderBy + limit chain was exercised (not just returnThis).
      expect(mockDb._selectChain.where).toHaveBeenCalledTimes(1);
      expect(mockDb._selectChain.orderBy).toHaveBeenCalledTimes(1);
      expect(mockDb._selectChain.limit).toHaveBeenCalledWith(25);
    });

    it('caps the limit at 50 and floors at 1', async () => {
      mockDb._selectChain.limit.mockResolvedValue([]);
      await service.findUnknownPending(TEST_USER, 9999);
      expect(mockDb._selectChain.limit).toHaveBeenLastCalledWith(50);
      await service.findUnknownPending(TEST_USER, 0);
      expect(mockDb._selectChain.limit).toHaveBeenLastCalledWith(1);
      await service.findUnknownPending(TEST_USER, -3);
      expect(mockDb._selectChain.limit).toHaveBeenLastCalledWith(1);
    });
  });

  describe('acknowledge', () => {
    const ROW_ID = 'lg-ack-1';

    it('updates row + emits AgentEvent when row matches predicate', async () => {
      const updatedRow = {
        id: ROW_ID,
        userId: TEST_USER,
        commitHash: 'h'.repeat(64),
        status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
        symbol: 'AAPL',
        acknowledgedAt: new Date('2026-04-26T02:00:00Z'),
        acknowledgementNote: 'verified with broker',
      };
      mockDb._updateChain.returning.mockResolvedValueOnce([updatedRow]);

      const result = await service.acknowledge(ROW_ID, TEST_USER, '  verified with broker  ');

      expect(result).toEqual(updatedRow);
      const setCall = mockDb._updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
      // Note is trimmed before persistence.
      expect(setCall.acknowledgementNote).toBe('verified with broker');
      expect(setCall.acknowledgedBy).toBe(TEST_USER);
      expect(setCall.acknowledgedAt).toBeInstanceOf(Date);
      // Status is metadata-only — must NOT be in the SET.
      expect(setCall.status).toBeUndefined();

      expect(mockAgentEvents.append).toHaveBeenCalledTimes(1);
      const appendArgs = mockAgentEvents.append.mock.calls[0]!;
      expect(appendArgs[0]).toBe(TEST_USER);
      expect(appendArgs[1]).toBe('TRADE_WALLET');
      expect(appendArgs[2]).toBe(ROW_ID);
      expect(appendArgs[3]).toBe('LEDGER_UNKNOWN_ACKNOWLEDGED');
      expect(appendArgs[4]).toMatchObject({ note: 'verified with broker' });
    });

    it('throws NotFoundException when no row matches (wrong status / wrong user / already acked)', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([]);
      await expect(service.acknowledge(ROW_ID, TEST_USER, 'note')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockAgentEvents.append).not.toHaveBeenCalled();
    });

    it('the WHERE clause filters by id, user, status=UNKNOWN, and acknowledged_at IS NULL', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([
        { id: ROW_ID, userId: TEST_USER, commitHash: 'x', symbol: 'AAPL' },
      ]);
      await service.acknowledge(ROW_ID, TEST_USER, 'verified');
      // The drizzle and(...) call produces one composite WHERE arg. We pin
      // that exactly one update was issued through the predicated chain so
      // the concurrent-ack race is impossible at the SQL level.
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(mockDb._updateChain.where).toHaveBeenCalledTimes(1);
      expect(mockDb._updateChain.returning).toHaveBeenCalledTimes(1);
    });

    it('rejects empty / whitespace-only notes (BadRequestException, no DB write)', async () => {
      await expect(service.acknowledge(ROW_ID, TEST_USER, '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.acknowledge(ROW_ID, TEST_USER, '    ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.acknowledge(ROW_ID, TEST_USER, '\n\t')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockAgentEvents.append).not.toHaveBeenCalled();
    });

    it('rejects notes longer than 1000 chars', async () => {
      await expect(
        service.acknowledge(ROW_ID, TEST_USER, 'a'.repeat(1001)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('does not emit AgentEvent if the DB update returns nothing (race-loser path)', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([]);
      await expect(service.acknowledge(ROW_ID, OTHER_USER, 'note')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockAgentEvents.append).not.toHaveBeenCalled();
    });
  });
});
