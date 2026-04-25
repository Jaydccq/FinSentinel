import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatUpgradePlannerService } from '../chat-upgrade-planner.service';

describe('ChatUpgradePlannerService.maybeUpgrade', () => {
  let preflight: { decide: ReturnType<typeof vi.fn> };
  let runs: { createQueued: ReturnType<typeof vi.fn> };
  let producer: { enqueuePreflight: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: ChatUpgradePlannerService;

  beforeEach(() => {
    preflight = { decide: vi.fn() };
    runs = {
      createQueued: vi.fn().mockResolvedValue({ id: 'run-1', userId: 'u1', status: 'QUEUED' }),
    };
    producer = { enqueuePreflight: vi.fn().mockResolvedValue(undefined) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new ChatUpgradePlannerService(
      preflight as never,
      runs as never,
      producer as never,
      events as never,
      { enabled: true },
    );
  });

  it('does NOT upgrade when preflight reports below-threshold', async () => {
    preflight.decide.mockResolvedValue({
      predictedToolCalls: 2,
      predictedToolRounds: 1,
      predictedWallClockSec: 5,
      upgradeRecommended: false,
      upgradeReason: 'below-threshold',
    });
    const result = await svc.maybeUpgrade({ userId: 'u1', sessionId: 's1', prompt: 'hi' });
    expect(result.upgraded).toBe(false);
    expect(runs.createQueued).not.toHaveBeenCalled();
  });

  it('upgrades when preflight recommends + enqueues + emits CHAT_AUTO_UPGRADED', async () => {
    preflight.decide.mockResolvedValue({
      predictedToolCalls: 8,
      predictedToolRounds: 4,
      predictedWallClockSec: 30,
      upgradeRecommended: true,
      upgradeReason: 'intent:complete analysis',
    });
    const result = await svc.maybeUpgrade({
      userId: 'u1',
      sessionId: 's1',
      prompt: 'complete analysis of AAPL',
    });
    expect(result.upgraded).toBe(true);
    expect(result.runId).toBe('run-1');
    expect(result.upgradeReason).toContain('intent');
    expect(runs.createQueued).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ sourceMode: 'CHAT', parentChatSessionId: 's1' }),
    );
    expect(producer.enqueuePreflight).toHaveBeenCalledWith({ runId: 'run-1', userId: 'u1' });
  });

  it('respects the feature flag off', async () => {
    svc = new ChatUpgradePlannerService(
      preflight as never,
      runs as never,
      producer as never,
      events as never,
      { enabled: false },
    );
    preflight.decide.mockResolvedValue({
      predictedToolCalls: 99,
      predictedToolRounds: 99,
      predictedWallClockSec: 99,
      upgradeRecommended: true,
      upgradeReason: 'x',
    });
    const result = await svc.maybeUpgrade({ userId: 'u1', sessionId: 's1', prompt: 'x' });
    expect(result.upgraded).toBe(false);
  });
});
