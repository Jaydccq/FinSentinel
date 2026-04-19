import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunOrchestratorService } from '../run-orchestrator.service';
import { StageGraphService } from '../stage-graph.service';
import { TeamPresetService } from '../team-preset.service';

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
    markStageSkipped: ReturnType<typeof vi.fn>;
  };
  let producer: {
    enqueuePreflight: ReturnType<typeof vi.fn>;
    enqueueExecuteStage: ReturnType<typeof vi.fn>;
  };
  let orchestrator: RunOrchestratorService;
  const stageGraph = new StageGraphService(new TeamPresetService());

  beforeEach(() => {
    runs = {
      markRunning: vi.fn().mockResolvedValue(undefined),
      setCurrentStage: vi.fn().mockResolvedValue(undefined),
      getForUser: vi.fn().mockResolvedValue({ id: 'r1', status: 'RUNNING', currentStageKey: 'THESIS', inputSnapshotJson: { preset: 'STANDARD_ANALYSIS', researchDepth: 'STANDARD' } }),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    checkpoints = {
      startStage: vi.fn().mockResolvedValue('stage-1'),
      markStageFailed: vi.fn().mockResolvedValue(undefined),
      markStageSkipped: vi.fn().mockResolvedValue(undefined),
    };
    producer = {
      enqueuePreflight: vi.fn().mockResolvedValue(undefined),
      enqueueExecuteStage: vi.fn().mockResolvedValue(undefined),
    };
    orchestrator = new RunOrchestratorService(runs as never, checkpoints as never, producer as never, stageGraph);
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
    runs.getForUser.mockResolvedValueOnce({ id: 'r1', status: 'RUNNING', currentStageKey: 'RISK', inputSnapshotJson: { preset: 'STANDARD_ANALYSIS', researchDepth: 'STANDARD' } });

    await orchestrator.step({ runId: 'r1', userId: 'u1', stepKind: 'RESUME' });

    expect(producer.enqueueExecuteStage).toHaveBeenCalledWith({
      runId: 'r1',
      userId: 'u1',
      stageKey: 'RISK',
    });
  });

  it('skips a disabled stage and advances to the next enabled one', async () => {
    // DEEP_THESIS has EXECUTION_PREP + HUMAN_APPROVAL disabled (only INTELLIGENCE, THESIS, RISK enabled)
    runs.getForUser.mockResolvedValueOnce({
      id: 'r1',
      userId: 'u1',
      status: 'RUNNING',
      inputSnapshotJson: { preset: 'DEEP_THESIS', researchDepth: 'STANDARD' },
      currentStageKey: 'EXECUTION_PREP',
    });

    const mockExecutionPrepExecutor = vi.fn().mockResolvedValue(undefined);
    orchestrator.registerStageExecutor('EXECUTION_PREP', mockExecutionPrepExecutor);

    await orchestrator.step({ runId: 'r1', userId: 'u1', stepKind: 'EXECUTE_STAGE', stageKey: 'EXECUTION_PREP' });

    expect(checkpoints.markStageSkipped).toHaveBeenCalledWith('u1', 'r1', 'EXECUTION_PREP', expect.any(Object));
    expect(mockExecutionPrepExecutor).not.toHaveBeenCalled();
  });
});
