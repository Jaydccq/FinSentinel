import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatRuntimeService } from '../heartbeat-runtime.service';

describe('HeartbeatRuntimeService.tick', () => {
  let hb: {
    listDueHeartbeats: ReturnType<typeof vi.fn>;
    markBeat: ReturnType<typeof vi.fn>;
  };
  let trigger: { trigger: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: HeartbeatRuntimeService;

  beforeEach(() => {
    hb = {
      listDueHeartbeats: vi.fn(),
      markBeat: vi.fn().mockResolvedValue(undefined),
    };
    trigger = { trigger: vi.fn().mockResolvedValue({ runId: 'run-hb' }) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new HeartbeatRuntimeService(hb as never, trigger as never, events as never, {
      enabled: true,
    });
  });

  it('triggers a HEARTBEAT run for each due user and updates lastBeatAt', async () => {
    hb.listDueHeartbeats.mockResolvedValue([
      { userId: 'u1', intervalSeconds: 600, drawdownAlertPct: '10.00' },
    ]);
    await svc.tick();
    expect(trigger.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sourceMode: 'HEARTBEAT' }),
    );
    expect(hb.markBeat).toHaveBeenCalledWith('u1', expect.any(Date));
    expect(events.append).toHaveBeenCalled();
  });

  it('is a no-op when disabled', async () => {
    svc = new HeartbeatRuntimeService(hb as never, trigger as never, events as never, {
      enabled: false,
    });
    hb.listDueHeartbeats.mockResolvedValue([
      { userId: 'u1', intervalSeconds: 600, drawdownAlertPct: '10.00' },
    ]);
    await svc.tick();
    expect(trigger.trigger).not.toHaveBeenCalled();
  });
});
