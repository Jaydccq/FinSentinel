import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HumanApprovalGateService } from '../teams/human-approval-gate.service';

describe('HumanApprovalGateService.execute', () => {
  let runs: {
    getForUser: ReturnType<typeof vi.fn>;
    transitionToWaitingApproval: ReturnType<typeof vi.fn>;
  };
  let checkpoints: { commitStage: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: HumanApprovalGateService;

  beforeEach(() => {
    runs = {
      getForUser: vi.fn().mockResolvedValue({ id: 'r1' }),
      transitionToWaitingApproval: vi.fn().mockResolvedValue(undefined),
    };
    checkpoints = { commitStage: vi.fn().mockResolvedValue(undefined) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new HumanApprovalGateService(runs as never, checkpoints as never, events as never);
  });

  it('transitions run to WAITING_APPROVAL and commits HUMAN_APPROVAL stage', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(runs.transitionToWaitingApproval).toHaveBeenCalledWith('u1', 'r1');
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'HUMAN_APPROVAL' }),
    );
  });
});
