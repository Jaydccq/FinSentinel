import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { AgentEventService } from '../agent-event.service';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';

// ── Constants ──────────────────────────────────────────────────────────────
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_AGGREGATE_ID = '22222222-2222-2222-2222-222222222222';
const TEST_EVENT_ID = '33333333-3333-3333-3333-333333333333';

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
function createMockDb() {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: TEST_EVENT_ID,
        seqNo: 1,
        userId: TEST_USER_ID,
        aggregateType: AgentEventAggregateType.TRADE_WALLET,
        aggregateId: TEST_AGGREGATE_ID,
        eventType: AgentEventType.TRADE_OPERATION_STAGED,
        payloadJson: { ticker: 'AAPL' },
        idempotencyKey: null,
        createdAt: new Date('2026-03-30T00:00:00Z'),
      },
    ]),
  };
  const countChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: 0 }]),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
    _countChain: countChain,
  };
}

describe('AgentEventService', () => {
  let service: AgentEventService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      providers: [
        AgentEventService,
        {
          provide: 'DRIZZLE_DB',
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get(AgentEventService);
  });

  // ── append ────────────────────────────────────────────────────────────────

  describe('append', () => {
    it('creates a new event and returns it', async () => {
      const result = await service.append(
        TEST_USER_ID,
        AgentEventAggregateType.TRADE_WALLET,
        TEST_AGGREGATE_ID,
        AgentEventType.TRADE_OPERATION_STAGED,
        { ticker: 'AAPL' },
        null,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(TEST_EVENT_ID);
      expect(result.userId).toBe(TEST_USER_ID);
      expect(result.aggregateType).toBe(AgentEventAggregateType.TRADE_WALLET);
      expect(result.eventType).toBe(AgentEventType.TRADE_OPERATION_STAGED);
      expect(result.payloadJson).toEqual({ ticker: 'AAPL' });

      // Verify insert was called
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('returns existing event when idempotency key matches', async () => {
      const existingEvent = {
        id: TEST_EVENT_ID,
        seqNo: 42,
        userId: TEST_USER_ID,
        aggregateType: AgentEventAggregateType.TRADE_WALLET,
        aggregateId: TEST_AGGREGATE_ID,
        eventType: AgentEventType.TRADE_OPERATION_STAGED,
        payloadJson: { ticker: 'AAPL' },
        idempotencyKey: 'unique-key-123',
        createdAt: new Date('2026-03-30T00:00:00Z'),
      };

      // Idempotency lookup returns an existing event
      mockDb._selectChain.limit.mockResolvedValueOnce([existingEvent]);

      const result = await service.append(
        TEST_USER_ID,
        AgentEventAggregateType.TRADE_WALLET,
        TEST_AGGREGATE_ID,
        AgentEventType.TRADE_OPERATION_STAGED,
        { ticker: 'AAPL' },
        'unique-key-123',
      );

      expect(result).toEqual(existingEvent);
      // Insert should NOT have been called — idempotent return
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('uses empty object when payload is null', async () => {
      const eventWithEmptyPayload = {
        id: TEST_EVENT_ID,
        seqNo: 1,
        userId: TEST_USER_ID,
        aggregateType: AgentEventAggregateType.CHAT_SESSION,
        aggregateId: null,
        eventType: AgentEventType.CHAT_SESSION_STARTED,
        payloadJson: {},
        idempotencyKey: null,
        createdAt: new Date('2026-03-30T00:00:00Z'),
      };
      mockDb._insertChain.returning.mockResolvedValueOnce([eventWithEmptyPayload]);

      const result = await service.append(
        TEST_USER_ID,
        AgentEventAggregateType.CHAT_SESSION,
        null,
        AgentEventType.CHAT_SESSION_STARTED,
        null,
        null,
      );

      expect(result.payloadJson).toEqual({});

      // Verify the values passed to insert had empty object
      const insertedValues = mockDb._insertChain.values.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedValues.payloadJson).toEqual({});
    });
  });

  // ── getRecent ─────────────────────────────────────────────────────────────

  describe('getRecent', () => {
    it('returns events in descending seqNo order with clamped limit', async () => {
      const events = [
        { id: 'e3', seqNo: 3, eventType: AgentEventType.TRADE_COMMIT_EXECUTED },
        { id: 'e2', seqNo: 2, eventType: AgentEventType.TRADE_COMMIT_CREATED },
        { id: 'e1', seqNo: 1, eventType: AgentEventType.TRADE_OPERATION_STAGED },
      ];
      mockDb._selectChain.limit.mockResolvedValueOnce(events);

      const result = await service.getRecent(TEST_USER_ID, 10);

      expect(result).toEqual(events);
      expect(result).toHaveLength(3);

      // Verify orderBy was called (desc ordering)
      expect(mockDb._selectChain.orderBy).toHaveBeenCalled();
      // Verify limit was called with the clamped value
      expect(mockDb._selectChain.limit).toHaveBeenCalledWith(10);
    });

    it('clamps limit to [1, 500] range and defaults null to 50', async () => {
      mockDb._selectChain.limit.mockResolvedValue([]);

      // null defaults to 50
      await service.getRecent(TEST_USER_ID, null);
      expect(mockDb._selectChain.limit).toHaveBeenCalledWith(50);

      // 0 clamps to 1
      await service.getRecent(TEST_USER_ID, 0);
      expect(mockDb._selectChain.limit).toHaveBeenCalledWith(1);

      // 999 clamps to 500
      await service.getRecent(TEST_USER_ID, 999);
      expect(mockDb._selectChain.limit).toHaveBeenCalledWith(500);
    });
  });

  // ── replayAfter ───────────────────────────────────────────────────────────

  describe('replayAfter', () => {
    it('returns events after the given seqNo in ascending order', async () => {
      const events = [
        { id: 'e6', seqNo: 6, eventType: AgentEventType.HEARTBEAT_TICK },
        { id: 'e7', seqNo: 7, eventType: AgentEventType.HEARTBEAT_ALERT },
      ];
      mockDb._selectChain.orderBy.mockReturnValueOnce(events);

      const result = await service.replayAfter(TEST_USER_ID, 5);

      expect(result).toEqual(events);
      expect(result).toHaveLength(2);
      // Verify select/from/where/orderBy chain was called
      expect(mockDb._selectChain.from).toHaveBeenCalled();
      expect(mockDb._selectChain.where).toHaveBeenCalled();
      expect(mockDb._selectChain.orderBy).toHaveBeenCalled();
    });
  });

  // ── countByUser ───────────────────────────────────────────────────────────

  describe('countByUser', () => {
    it('returns the correct count for a user', async () => {
      // Override select to return the count chain for this call
      const countSelectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 42 }]),
      };
      mockDb.select.mockReturnValueOnce(countSelectChain);

      const result = await service.countByUser(TEST_USER_ID);

      expect(result).toBe(42);
    });
  });
});
