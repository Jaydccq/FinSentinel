import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { analysisStages, analysisArtifacts } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type StageStructuredOutput,
  stageStructuredOutputSchema,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';

interface CommitStageArgs {
  userId: string;
  runId: string;
  stageKey: AnalysisStageKey;
  structuredOutput: StageStructuredOutput;
  humanReportMarkdown: string;
}

interface StageRow {
  id: string;
  checkpointVersion: number;
}

@Injectable()
export class AnalysisCheckpointService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly events: AgentEventService,
  ) {}

  async startStage(runId: string, stageKey: AnalysisStageKey): Promise<string> {
    // Supply every nullable column explicitly to avoid the Drizzle+postgres.js
    // mixed-default bind bug (see agent-event.service.ts + local-user.seeder.ts).
    //
    // ON CONFLICT: BullMQ retries (default 3 attempts) call startStage again on
    // the same (runId, stageKey). The UNIQUE constraint uk_analysis_stages_run_stage_key
    // would throw on the second attempt. The upsert resets the row to RUNNING,
    // bumps checkpointVersion, and clears prior error state so the retry proceeds.
    const now = new Date();
    const [stage] = await this.db
      .insert(analysisStages)
      .values({
        id: randomUUID(),
        runId,
        stageKey,
        status: 'RUNNING',
        checkpointVersion: 0,
        parallelGroupKey: null,
        structuredOutputJson: null,
        humanReportMarkdown: null,
        errorJson: null,
        startedAt: now,
        completedAt: null,
      })
      .onConflictDoUpdate({
        target: [analysisStages.runId, analysisStages.stageKey],
        set: {
          status: 'RUNNING',
          checkpointVersion: sql`${analysisStages.checkpointVersion} + 1`,
          errorJson: null,
          startedAt: now,
          completedAt: null,
        },
      })
      .returning();
    return (stage as StageRow).id;
  }

  async commitStage(args: CommitStageArgs): Promise<void> {
    const parsed = stageStructuredOutputSchema.parse(args.structuredOutput);

    const [stage] = await this.db
      .select()
      .from(analysisStages)
      .where(
        and(
          eq(analysisStages.runId, args.runId),
          eq(analysisStages.stageKey, args.stageKey),
        ),
      )
      .limit(1);
    if (!stage) {
      throw new NotFoundException(
        `Stage ${args.stageKey} not found for run ${args.runId}`,
      );
    }
    const row = stage as StageRow;
    const nextVersion = row.checkpointVersion + 1;

    await this.db
      .update(analysisStages)
      .set({
        status: 'COMPLETED',
        checkpointVersion: nextVersion,
        structuredOutputJson: parsed as Record<string, unknown>,
        humanReportMarkdown: args.humanReportMarkdown,
        completedAt: new Date(),
      })
      .where(eq(analysisStages.id, row.id));

    await this.db.insert(analysisArtifacts).values({
      id: randomUUID(),
      runId: args.runId,
      stageId: row.id,
      artifactKind: 'STAGE_STRUCTURED_OUTPUT',
      artifactName: `${args.stageKey.toLowerCase()}-structured.json`,
      mimeType: 'application/json',
      payloadJson: parsed as Record<string, unknown>,
      createdAt: new Date(),
    });
    await this.db.insert(analysisArtifacts).values({
      id: randomUUID(),
      runId: args.runId,
      stageId: row.id,
      artifactKind: 'STAGE_HUMAN_REPORT',
      artifactName: `${args.stageKey.toLowerCase()}-report.md`,
      mimeType: 'text/markdown',
      payloadJson: { markdown: args.humanReportMarkdown },
      createdAt: new Date(),
    });

    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      AgentEventType.STAGE_CHECKPOINT_COMMITTED,
      { stageKey: args.stageKey, checkpointVersion: nextVersion },
      null,
    );
  }

  async findByStage(runId: string, stageKey: AnalysisStageKey): Promise<{
    structuredOutputJson: Record<string, unknown> | null;
  } | null> {
    const [row] = await this.db
      .select()
      .from(analysisStages)
      .where(
        and(eq(analysisStages.runId, runId), eq(analysisStages.stageKey, stageKey)),
      )
      .limit(1);
    if (!row) return null;
    return row as { structuredOutputJson: Record<string, unknown> | null };
  }

  async writeOrderDrafts(args: {
    runId: string;
    stageId: string | null;
    payload: { orderDrafts: unknown[] };
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(analysisArtifacts)
      .values({
        id: randomUUID(),
        runId: args.runId,
        stageId: args.stageId ?? undefined,
        artifactKind: 'ORDER_DRAFTS',
        artifactName: 'order-drafts.json',
        mimeType: 'application/json',
        payloadJson: args.payload as Record<string, unknown>,
        createdAt: new Date(),
      })
      .returning();
    return row as { id: string };
  }

  async writeExecutionPayload(args: {
    runId: string;
    payload: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(analysisArtifacts)
      .values({
        id: randomUUID(),
        runId: args.runId,
        artifactKind: 'EXECUTION_PAYLOAD',
        artifactName: 'execution-payload.json',
        mimeType: 'application/json',
        payloadJson: args.payload,
        createdAt: new Date(),
      })
      .returning();
    return row as { id: string };
  }

  async markStageFailed(
    userId: string,
    runId: string,
    stageKey: AnalysisStageKey,
    error: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(analysisStages)
      .set({ status: 'FAILED', errorJson: error, completedAt: new Date() })
      .where(
        and(eq(analysisStages.runId, runId), eq(analysisStages.stageKey, stageKey)),
      );
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_FAILED,
      { stageKey, error },
      null,
    );
  }
}
