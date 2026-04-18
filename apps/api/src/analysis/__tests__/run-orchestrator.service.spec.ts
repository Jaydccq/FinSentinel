import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunOrchestratorService } from '../run-orchestrator.service';

describe('RunOrchestratorService runtime gating', () => {
  let runs: {
    markRunning: ReturnType<typeof vi.fn>;
    setCurrentStage: ReturnType<typeof vi.fn>;
    getForUser: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  let checkpoints: {
    startStage: ReturnType<typeof vi.fn>;
    markStageFailed: ReturnType<typeof vi.fn>;
  };
  let producer: {
    enqueuePreflight: ReturnType<typeof vi.fn>;
    enqueueExecuteStage: ReturnType<typeof vi.fn>;
  };
  let orchestrator: RunOrchestratorService;

  beforeEach(() => {
    runs = {
      markRunning: vi.fn().mockResolvedValue(undefined),
      setCurrentStage: vi.fn().mockResolvedValue(undefined),
      getForUser: vi.fn().mockResolvedValue({ id: 'r1', status: 'RUNNING', currentStageKey: 'THESIS' }),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    checkpoints = {
      startStage: vi.fn().mockResolvedValue('stage-1'),
      markStageFailed: vi.fn().mockResolvedValue(undefined),
    };
    producer = {
      enqueuePreflight: vi.fn().mockResolvedValue(undefined),
      enqueueExecuteStage: vi.fn().mockResolvedValue(undefined),
    };
    orchestrator = new RunOrchestratorService(runs as never, checkpoints as never, producer as never);
  });

  it('does not execute a paused run stage', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    runs.getForUser.mockResolvedValueOnce({ id: 'r1', status: 'PAUSED', currentStageKey: 'THESIS' });
    orchestrator.registerStageExecutor('THESIS', executor);

    await orchestrator.step({
      runId: 'r1',
      userId: 'u1',
      stepKind: 'EXECUTE_STAGE',
      stageKey: 'THESIS',
    });

    expect(checkpoints.startStage).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    expect(producer.enqueueExecuteStage).not.toHaveBeenCalled();
  });

  it('does not enqueue the next stage when a run is paused during execution', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    runs.getForUser
      .mockResolvedValueOnce({ id: 'r1', status: 'RUNNING', currentStageKey: 'INTELLIGENCE' })
      .mockResolvedValueOnce({ id: 'r1', status: 'PAUSED', currentStageKey: 'INTELLIGENCE' });
    orchestrator.registerStageExecutor('INTELLIGENCE', executor);

    await orchestrator.step({
      runId: 'r1',
      userId: 'u1',
      stepKind: 'EXECUTE_STAGE',
      stageKey: 'INTELLIGENCE',
    });

    expect(executor).toHaveBeenCalledOnce();
    expect(producer.enqueueExecuteStage).not.toHaveBeenCalled();
  });

  it('resume enqueues the current stage when the run is running', async () => {
    runs.getForUser.mockResolvedValueOnce({ id: 'r1', status: 'RUNNING', currentStageKey: 'RISK' });

    await orchestrator.step({ runId: 'r1', userId: 'u1', stepKind: 'RESUME' });

    expect(producer.enqueueExecuteStage).toHaveBeenCalledWith({
      runId: 'r1',
      userId: 'u1',
      stageKey: 'RISK',
    });
  });
});
