import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import type { AnalysisStageKey } from '@finsentinel/shared';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';
import type { AnalysisRunJobData } from '../queue/analysis-run.producer';

const TEAM_STAGE_ORDER: AnalysisStageKey[] = [
  'INTELLIGENCE',
  'THESIS',
  'RISK',
  'EXECUTION_PREP',
  'HUMAN_APPROVAL',
];

/**
 * Step-driven orchestrator. Each BullMQ job invokes `step(data)`. This class
 * owns the state machine; team-level execution is injected by Plan B via
 * `registerStageExecutor`.
 */
@Injectable()
export class RunOrchestratorService {
  private readonly logger = new Logger(RunOrchestratorService.name);
  private readonly stageExecutors = new Map<
    AnalysisStageKey,
    (args: { runId: string; userId: string }) => Promise<void>
  >();

  constructor(
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    @Inject(forwardRef(() => AnalysisRunProducer))
    private readonly producer: AnalysisRunProducer,
  ) {}

  registerStageExecutor(
    stageKey: AnalysisStageKey,
    executor: (args: { runId: string; userId: string }) => Promise<void>,
  ): void {
    this.stageExecutors.set(stageKey, executor);
  }

  async step(data: AnalysisRunJobData): Promise<void> {
    switch (data.stepKind) {
      case 'PREFLIGHT':
        await this.handlePreflight(data);
        return;
      case 'EXECUTE_STAGE':
        await this.handleExecuteStage(data);
        return;
      case 'RESUME':
        await this.handleResume(data);
        return;
    }
  }

  private async handlePreflight(data: AnalysisRunJobData): Promise<void> {
    await this.runs.markRunning(data.userId, data.runId);
    const first = TEAM_STAGE_ORDER[0]!;
    await this.runs.setCurrentStage(data.userId, data.runId, first);
    await this.producer.enqueueExecuteStage({
      runId: data.runId,
      userId: data.userId,
      stageKey: first,
    });
  }

  private async handleExecuteStage(data: AnalysisRunJobData): Promise<void> {
    if (!data.stageKey) {
      throw new Error('execute-stage job missing stageKey');
    }
    const executor = this.stageExecutors.get(data.stageKey);
    if (!executor) {
      this.logger.warn(
        `No executor registered for stage ${data.stageKey}; skipping (Plan B adds this)`,
      );
      return;
    }
    try {
      await this.checkpoints.startStage(data.runId, data.stageKey);
      await executor({ runId: data.runId, userId: data.userId });
      const next = this.nextStage(data.stageKey);
      if (next === null) {
        await this.runs.markCompleted(data.userId, data.runId);
      } else {
        await this.runs.setCurrentStage(data.userId, data.runId, next);
        await this.producer.enqueueExecuteStage({
          runId: data.runId,
          userId: data.userId,
          stageKey: next,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.checkpoints.markStageFailed(data.userId, data.runId, data.stageKey, {
        message,
      });
      await this.runs.markFailed(data.userId, data.runId, message);
      throw err;
    }
  }

  private async handleResume(data: AnalysisRunJobData): Promise<void> {
    const run = await this.runs.getForUser(data.userId, data.runId);
    if (!run?.currentStageKey) {
      await this.producer.enqueuePreflight({ runId: data.runId, userId: data.userId });
      return;
    }
    await this.producer.enqueueExecuteStage({
      runId: data.runId,
      userId: data.userId,
      stageKey: run.currentStageKey as AnalysisStageKey,
    });
  }

  private nextStage(current: AnalysisStageKey): AnalysisStageKey | null {
    const idx = TEAM_STAGE_ORDER.indexOf(current);
    if (idx === -1) return null;
    const next = TEAM_STAGE_ORDER[idx + 1];
    return next ?? null;
  }
}
