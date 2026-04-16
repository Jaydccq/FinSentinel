import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalysisRuntimeTriggerService } from '../analysis-runtime-trigger.service';

describe('AnalysisRuntimeTriggerService.trigger', () => {
  let runs: { createQueued: ReturnType<typeof vi.fn> };
  let producer: { enqueuePreflight: ReturnType<typeof vi.fn> };
  let svc: AnalysisRuntimeTriggerService;

  beforeEach(() => {
    runs = {
      createQueued: vi.fn().mockResolvedValue({ id: 'run-9', userId: 'u1' }),
    };
    producer = { enqueuePreflight: vi.fn().mockResolvedValue(undefined) };
    svc = new AnalysisRuntimeTriggerService(runs as never, producer as never);
  });

  it('schedule source persists with sourceMode=SCHEDULE and enqueues preflight', async () => {
    const out = await svc.trigger({
      userId: 'u1',
      sourceMode: 'SCHEDULE',
      prompt: 'daily risk check',
      payload: { scheduleId: 'sched-1' },
    });
    expect(out.runId).toBe('run-9');
    expect(runs.createQueued).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ sourceMode: 'SCHEDULE', prompt: 'daily risk check' }),
    );
    expect(producer.enqueuePreflight).toHaveBeenCalledWith({ runId: 'run-9', userId: 'u1' });
  });

  it('heartbeat source persists with sourceMode=HEARTBEAT', async () => {
    await svc.trigger({
      userId: 'u1',
      sourceMode: 'HEARTBEAT',
      prompt: 'drawdown check',
    });
    expect(runs.createQueued).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ sourceMode: 'HEARTBEAT' }),
    );
  });
});
