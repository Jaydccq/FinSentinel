import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleRuntimeService } from '../schedule-runtime.service';

describe('ScheduleRuntimeService.tick', () => {
  let schedules: {
    listDueSchedules: ReturnType<typeof vi.fn>;
    markScheduleRan: ReturnType<typeof vi.fn>;
  };
  let trigger: { trigger: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: ScheduleRuntimeService;

  beforeEach(() => {
    schedules = {
      listDueSchedules: vi.fn(),
      markScheduleRan: vi.fn().mockResolvedValue(undefined),
    };
    trigger = { trigger: vi.fn().mockResolvedValue({ runId: 'run-x' }) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new ScheduleRuntimeService(schedules as never, trigger as never, events as never, {
      enabled: true,
    });
  });

  it('triggers a run for every due schedule and advances nextRunAt', async () => {
    schedules.listDueSchedules.mockResolvedValue([
      {
        id: 'sch-1',
        userId: 'u1',
        cronExpression: '0 * * * *',
        taskType: 'PORTFOLIO_REVIEW',
        taskPayload: { portfolioId: 'p1' },
      },
    ]);
    await svc.tick();
    expect(trigger.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sourceMode: 'SCHEDULE' }),
    );
    expect(schedules.markScheduleRan).toHaveBeenCalledWith(
      'sch-1',
      expect.any(Date),
      expect.any(Date),
    );
    expect(events.append).toHaveBeenCalled();
  });

  it('is a no-op when disabled', async () => {
    svc = new ScheduleRuntimeService(schedules as never, trigger as never, events as never, {
      enabled: false,
    });
    schedules.listDueSchedules.mockResolvedValue([{ id: 'x' }]);
    await svc.tick();
    expect(trigger.trigger).not.toHaveBeenCalled();
  });
});
