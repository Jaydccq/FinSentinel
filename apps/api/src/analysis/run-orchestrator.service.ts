import { Injectable, Logger, forwardRef, Inject, Optional } from '@nestjs/common';
import type { AnalysisPreset, AnalysisStageKey, ResearchDepth } from '@finsentinel/shared';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { ContextJournalService } from './context-journal.service';
import { RunReportAssembler } from './run-report-assembler.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';
import type { AnalysisRunJobData } from '../queue/analysis-run.producer';
import { StageGraphService } from './stage-graph.service';

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
    private readonly stageGraph: StageGraphService,
    @Optional() private readonly contextJournal?: ContextJournalService,
    @Optional() private readonly reportAssembler?: RunReportAssembler,
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

  private extractRuntimeConfig(snapshot: unknown): {
    preset: AnalysisPreset;
    researchDepth: ResearchDepth;
    enabledTeams?: AnalysisStageKey[];
  } {
    const src = (snapshot ?? {}) as Record<string, unknown>;
    const preset = (src.preset as AnalysisPreset | undefined) ?? 'STANDARD_ANALYSIS';
    const researchDepth = (src.researchDepth as ResearchDepth | undefined) ?? 'STANDARD';
    const enabledTeams = Array.isArray(src.enabledTeams)
      ? (src.enabledTeams as AnalysisStageKey[])
      : undefined;
    return { preset, researchDepth, enabledTeams };
  }

  private async handlePreflight(data: AnalysisRunJobData): Promise<void> {
    const run = await this.runs.getForUser(data.userId, data.runId);
    if (!run || run.status === 'CANCELED' || run.status === 'PAUSED') {
      return;
    }
    await this.runs.markRunning(data.userId, data.runId);
    const runtimeConfig = this.extractRuntimeConfig(run.inputSnapshotJson);
    const graph = this.stageGraph.build(runtimeConfig);
    const firstEnabled = graph.find((n) => n.status === 'ENABLED')?.stageKey ?? null;
    if (!firstEnabled) {
      // No enabled stages — complete immediately.
      await this.completeRun(data.userId, data.runId);
      return;
    }
    await this.runs.setCurrentStage(data.userId, data.runId, firstEnabled);
    await this.producer.enqueueExecuteStage({
      runId: data.runId,
      userId: data.userId,
      stageKey: firstEnabled,
    });
  }

  private async handleExecuteStage(data: AnalysisRunJobData): Promise<void> {
    if (!data.stageKey) {
      throw new Error('execute-stage job missing stageKey');
    }
    const runBeforeStage = await this.runs.getForUser(data.userId, data.runId);
    if (!runBeforeStage || runBeforeStage.status !== 'RUNNING') {
      return;
    }

    // Skip-and-advance when the current stage is disabled by runtime config.
    const runtimeConfig = this.extractRuntimeConfig(runBeforeStage.inputSnapshotJson);
    const graph = this.stageGraph.build(runtimeConfig);
    const node = graph.find((g) => g.stageKey === data.stageKey);
    if (node && node.status === 'SKIPPED') {
      await this.checkpoints.markStageSkipped(data.userId, data.runId, data.stageKey, {
        reason: 'disabled_by_runtime_config',
      });
      const next = this.stageGraph.nextEnabled(graph, data.stageKey);
      if (next) {
        await this.runs.setCurrentStage(data.userId, data.runId, next);
        await this.producer.enqueueExecuteStage({
          runId: data.runId,
          userId: data.userId,
          stageKey: next,
        });
      } else {
        await this.completeRun(data.userId, data.runId);
      }
      return;
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
      const run = await this.runs.getForUser(data.userId, data.runId);
      if (
        data.stageKey === 'HUMAN_APPROVAL' ||
        run?.status === 'WAITING_APPROVAL' ||
        run?.status === 'PAUSED' ||
        run?.status === 'CANCELED' ||
        run?.status === 'FAILED'
      ) {
        // Hard stop — control/approval paths re-enqueue explicitly when execution should continue.
        return;
      }
      const next = this.stageGraph.nextEnabled(graph, data.stageKey);
      if (next === null) {
        await this.completeRun(data.userId, data.runId);
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
    if (!run || run.status !== 'RUNNING') {
      return;
    }
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

  private async completeRun(userId: string, runId: string): Promise<void> {
    if (!this.contextJournal || !this.reportAssembler) {
      await this.runs.markCompleted(userId, runId);
      return;
    }

    const sharedContext = await this.contextJournal.getRunContext(userId, runId);
    const stages = await this.runs.listStagesForRun(runId);
    const artifacts = await this.runs.listArtifactsForRun(runId);
    const executionArtifact = artifacts.find(
      (artifact) => artifact.artifactKind === 'EXECUTION_PAYLOAD',
    );
    const assembled = this.reportAssembler.build({
      sharedContext,
      stages: stages.map((stage) => ({
        stageKey: stage.stageKey,
        humanReportMarkdown: stage.humanReportMarkdown,
        structuredOutput: stage.structuredOutputJson,
      })),
      executionPayload: executionArtifact?.payloadJson ?? null,
    });

    await this.runs.completeWithOutputs({
      userId,
      runId,
      sharedContext,
      decisionObject: assembled.decisionObject,
      finalReportMarkdown: assembled.finalReportMarkdown,
    });
  }
}
