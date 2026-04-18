import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { analysisRuns, analysisStages, analysisArtifacts, analysisApprovals } from '@finsentinel/db';
import { eq, and, desc, asc } from 'drizzle-orm';
import type { DrizzleDB } from '@finsentinel/db';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type AnalysisRunSourceMode,
  type AnalysisRunStatus,
  type CreateRunRequest,
  type DecisionObject,
  type SharedContext,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';

interface AnalysisRunRow {
  id: string;
  userId: string;
  sourceMode: AnalysisRunSourceMode;
  status: AnalysisRunStatus;
  currentStageKey: string | null;
  inputSnapshotJson: Record<string, unknown>;
}

@Injectable()
export class AnalysisRunService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly events: AgentEventService,
  ) {}

  async createQueued(userId: string, req: CreateRunRequest): Promise<AnalysisRunRow> {
    const idempotencyKey = `run:create:${userId}:${randomUUID()}`;
    // Supply id + timestamps explicitly to avoid the Drizzle+postgres.js
    // mixed-default bind bug (see agent-event.service.ts for details).
    const now = new Date();
    const [created] = await this.db
      .insert(analysisRuns)
      .values({
        id: randomUUID(),
        userId,
        sourceMode: req.sourceMode,
        status: 'QUEUED',
        parentChatSessionId: req.parentChatSessionId,
        inputSnapshotJson: {
          prompt: req.prompt,
          ticker: req.ticker,
          portfolioId: req.portfolioId,
          enabledTeams: req.enabledTeams,
          researchDepth: req.researchDepth ?? 'STANDARD',
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = created as AnalysisRunRow;
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      row.id,
      AgentEventType.RUN_QUEUED,
      { sourceMode: req.sourceMode, prompt: req.prompt, ticker: req.ticker ?? null },
      idempotencyKey,
    );
    return row;
  }

  async getForUser(userId: string, runId: string): Promise<AnalysisRunRow | null> {
    const [row] = await this.db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)))
      .limit(1);
    return (row as AnalysisRunRow | undefined) ?? null;
  }

  async listByUser(userId: string, limit = 50): Promise<AnalysisRunRow[]> {
    return (await this.db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.userId, userId))
      .orderBy(desc(analysisRuns.createdAt))
      .limit(limit)) as AnalysisRunRow[];
  }

  async markRunning(userId: string, runId: string): Promise<void> {
    await this.transitionStatus(userId, runId, 'RUNNING');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_STARTED,
      {},
      null,
    );
  }

  async pause(userId: string, runId: string): Promise<void> {
    const row = await this.requireRun(userId, runId);
    if (row.status !== 'RUNNING') {
      throw new BadRequestException(`Cannot pause run in status ${row.status}`);
    }
    await this.transitionStatus(userId, runId, 'PAUSED');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_PAUSED,
      {},
      null,
    );
  }

  async resume(userId: string, runId: string): Promise<void> {
    const row = await this.requireRun(userId, runId);
    if (row.status !== 'PAUSED') {
      throw new BadRequestException(`Cannot resume run in status ${row.status}`);
    }
    await this.transitionStatus(userId, runId, 'RUNNING');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_RESUMED,
      {},
      null,
    );
  }

  async cancel(userId: string, runId: string): Promise<void> {
    const row = await this.requireRun(userId, runId);
    if (row.status === 'COMPLETED' || row.status === 'CANCELED') {
      throw new BadRequestException(`Run already ${row.status}`);
    }
    await this.transitionStatus(userId, runId, 'CANCELED');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_CANCELED,
      {},
      null,
    );
  }

  async retryStage(
    userId: string,
    runId: string,
    stageKey: AnalysisStageKey,
  ): Promise<void> {
    const row = await this.requireRun(userId, runId);
    if (!['FAILED', 'PAUSED', 'WAITING_APPROVAL'].includes(row.status)) {
      throw new BadRequestException(`Cannot retry run in status ${row.status}`);
    }
    await this.db
      .update(analysisRuns)
      .set({
        status: 'RUNNING',
        currentStageKey: stageKey,
        updatedAt: new Date(),
      })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)));
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_RESUMED,
      { retry: true, stageKey },
      null,
    );
  }

  async transitionToWaitingApproval(userId: string, runId: string): Promise<void> {
    await this.transitionStatus(userId, runId, 'WAITING_APPROVAL');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.EXECUTION_APPROVAL_REQUIRED,
      {},
      null,
    );
  }

  async markFailed(userId: string, runId: string, error: string): Promise<void> {
    await this.transitionStatus(userId, runId, 'FAILED');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_FAILED,
      { error },
      null,
    );
  }

  async markCompleted(userId: string, runId: string): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)));
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_COMPLETED,
      {},
      null,
    );
  }

  async completeWithOutputs(args: {
    userId: string;
    runId: string;
    sharedContext: SharedContext | null;
    decisionObject: DecisionObject | null;
    finalReportMarkdown: string;
  }): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({
        status: 'COMPLETED',
        sharedContextJson: args.sharedContext,
        decisionObjectJson: args.decisionObject,
        finalReportMarkdown: args.finalReportMarkdown,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(analysisRuns.id, args.runId), eq(analysisRuns.userId, args.userId)));
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      AgentEventType.RUN_COMPLETED,
      {},
      null,
    );
  }

  async setCurrentStage(
    userId: string,
    runId: string,
    stageKey: string,
  ): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({ currentStageKey: stageKey as never, updatedAt: new Date() })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)));
  }

  private async requireRun(userId: string, runId: string): Promise<AnalysisRunRow> {
    const row = await this.getForUser(userId, runId);
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    return row;
  }

  private async transitionStatus(
    userId: string,
    runId: string,
    status: AnalysisRunStatus,
  ): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)));
  }

  async listStagesForRun(runId: string) {
    return this.db
      .select()
      .from(analysisStages)
      .where(eq(analysisStages.runId, runId))
      .orderBy(asc(analysisStages.startedAt));
  }

  async listArtifactsForRun(runId: string) {
    return this.db
      .select()
      .from(analysisArtifacts)
      .where(eq(analysisArtifacts.runId, runId))
      .orderBy(desc(analysisArtifacts.createdAt));
  }

  async listApprovalsForRun(runId: string) {
    return this.db
      .select()
      .from(analysisApprovals)
      .where(eq(analysisApprovals.runId, runId))
      .orderBy(desc(analysisApprovals.requestedAt));
  }
}
