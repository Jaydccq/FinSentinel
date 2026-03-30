import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScheduleService } from '../schedule.service';

// ── Constants ──────────────────────────────────────────────────────────────
const USER_ID = '11111111-1111-1111-1111-111111111111';
const SCHEDULE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-03-30T12:00:00Z');

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
function createMockDb() {
  const selectResults: unknown[][] = [];

  function makeSelectChain(): Record<string, ReturnType<typeof vi.fn>> {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockImplementation(() => {
      chain.orderBy.mockImplementation(() => {
        const result = selectResults.shift() ?? [];
        return Promise.resolve(result);
      });
      chain.limit.mockImplementation(() => {
        const result = selectResults.shift() ?? [];
        return Promise.resolve(result);
      });
      // Make where itself thenable (for queries without limit/orderBy)
      const thenableChain = {
        ...chain,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          const result = selectResults.shift() ?? [];
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return thenableChain;
    });
    return chain;
  }

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const deleteChain = {
    where: vi.fn().mockResolvedValue([]),
  };

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    delete: vi.fn().mockReturnValue(deleteChain),
    _insertChain: insertChain,
    _updateChain: updateChain,
    _deleteChain: deleteChain,
    _selectResults: selectResults,
    enqueueSelect(...results: unknown[][]) {
      for (const r of results) {
        selectResults.push(r);
      }
    },
  };
}

describe('ScheduleService', () => {
  let service: ScheduleService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      providers: [
        ScheduleService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
      ],
    }).compile();

    service = module.get(ScheduleService);
  });

  // ── Test: create succeeds ────────────────────────────────────────────────

  it('create schedule succeeds', async () => {
    const created = {
      id: SCHEDULE_ID,
      userId: USER_ID,
      name: 'Daily market pulse',
      cronExpression: '0 9 * * 1-5',
      taskType: 'MARKET_PULSE',
      taskPayload: {},
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };

    // Count query: user has 0 schedules
    mockDb.enqueueSelect([{ count: 0 }]);
    mockDb._insertChain.returning.mockResolvedValueOnce([created]);

    const result = await service.create(
      USER_ID,
      'Daily market pulse',
      '0 9 * * 1-5',
      'MARKET_PULSE',
    );

    expect(result.id).toBe(SCHEDULE_ID);
    expect(result.name).toBe('Daily market pulse');
    expect(result.cronExpression).toBe('0 9 * * 1-5');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  // ── Test: invalid cron ───────────────────────────────────────────────────

  it('create rejects invalid cron expression', async () => {
    await expect(
      service.create(USER_ID, 'Bad schedule', 'not-a-cron', 'MARKET_PULSE'),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.create(USER_ID, 'Bad schedule', '', 'MARKET_PULSE'),
    ).rejects.toThrow(BadRequestException);

    // Too few fields
    await expect(
      service.create(USER_ID, 'Bad schedule', '0 9 *', 'MARKET_PULSE'),
    ).rejects.toThrow(BadRequestException);
  });

  // ── Test: max schedules ──────────────────────────────────────────────────

  it('create rejects when user at max (20) schedules', async () => {
    // Count query: user has 20 schedules
    mockDb.enqueueSelect([{ count: 20 }]);

    await expect(
      service.create(USER_ID, 'One more', '0 9 * * *', 'MARKET_PULSE'),
    ).rejects.toThrow(BadRequestException);

    // Insert should NOT have been called
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── Test: delete ─────────────────────────────────────────────────────────

  it('delete removes schedule', async () => {
    // Ownership check: schedule found
    mockDb.enqueueSelect([
      {
        id: SCHEDULE_ID,
        userId: USER_ID,
        name: 'To delete',
        cronExpression: '0 9 * * *',
        taskType: 'MARKET_PULSE',
        taskPayload: {},
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    await service.delete(USER_ID, SCHEDULE_ID);

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('delete throws NotFoundException when schedule does not exist', async () => {
    // Ownership check: schedule not found
    mockDb.enqueueSelect([]);

    await expect(
      service.delete(USER_ID, SCHEDULE_ID),
    ).rejects.toThrow(NotFoundException);
  });
});
