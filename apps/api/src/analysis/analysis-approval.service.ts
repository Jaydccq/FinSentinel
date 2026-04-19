import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { analysisApprovals } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import {
  AgentEventAggregateType,
  AgentEventType,
  orderDraftsPayloadSchema,
  type OrderDraftsPayload,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { ContextJournalService } from './context-journal.service';
import { RunReportAssembler } from './run-report-assembler.service';
import { OrderDraftMapper } from '../trading/order-draft-mapper.service';
import { UnifiedTradingService } from '../trading/unified-trading.service';
import { ExecutionReviewLedgerService } from './execution-review-ledger.service';

export const APPROVAL_AUTO_DISPATCH_FLAG_TOKEN = 'APPROVAL_AUTO_DISPATCH_FLAG';

export type ApprovalDecision = 'APPROVE' | 'REJECT';

interface ApprovalRow {
  id: string;
  runId: string;
  status: string;
  requestedPayloadJson: Record<string, unknown>;
}

@Injectable()
export class AnalysisApprovalService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly events: AgentEventService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly mapper: OrderDraftMapper,
    private readonly trading: UnifiedTradingService,
    @Inject(APPROVAL_AUTO_DISPATCH_FLAG_TOKEN)
    private readonly autoDispatchFlag: { enabled: boolean },
    @Optional() private readonly contextJournal?: ContextJournalService,
    @Optional() private readonly reportAssembler?: RunReportAssembler,
    @Optional() private readonly ledger?: ExecutionReviewLedgerService,
  ) {}

  async request(args: {
    userId: string;
    runId: string;
    payload: OrderDraftsPayload;
    orderDraftArtifactId: string;
  }): Promise<ApprovalRow> {
    const parsed = orderDraftsPayloadSchema.parse(args.payload);
    const [row] = await this.db
      .insert(analysisApprovals)
      .values({
        id: randomUUID(),
        runId: args.runId,
        approvalType: 'EXECUTION_APPROVAL',
        status: 'PENDING',
        requestedPayloadJson: parsed as unknown as Record<string, unknown>,
        requestedAt: new Date(),
      })
      .returning();
    const created = row as ApprovalRow;

    // Create drafted ledger bound to this approval + source artifact.
    if (this.ledger) {
      await this.ledger.createDraft({
        runId: args.runId,
        approvalId: created.id,
        orderDraftRefs: [args.orderDraftArtifactId],
      });
    }

    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      created.id,
      AgentEventType.EXECUTION_APPROVAL_REQUIRED,
      {
        runId: args.runId,
        draftCount: parsed.orderDrafts.length,
        orderDraftArtifactId: args.orderDraftArtifactId,
      },
      `approval:request:${created.id}`,
    );
    return created;
  }

  async resolve(args: {
    userId: string;
    approvalId: string;
    decision: ApprovalDecision;
    note?: string;
  }): Promise<void> {
    const [row] = await this.db
      .select()
      .from(analysisApprovals)
      .where(eq(analysisApprovals.id, args.approvalId))
      .limit(1);
    if (!row) throw new NotFoundException(`Approval ${args.approvalId} not found`);
    const existing = row as ApprovalRow;
    if (existing.status !== 'PENDING') {
      throw new BadRequestException(`Approval already resolved: ${existing.status}`);
    }
    const newStatus = args.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.db
      .update(analysisApprovals)
      .set({
        status: newStatus,
        approvedPayloadJson:
          args.decision === 'APPROVE' ? existing.requestedPayloadJson : null,
        resolvedAt: new Date(),
        resolvedByUserId: args.userId,
      })
      .where(eq(analysisApprovals.id, args.approvalId));
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      args.approvalId,
      args.decision === 'APPROVE'
        ? AgentEventType.EXECUTION_APPROVED
        : AgentEventType.EXECUTION_REJECTED,
      { note: args.note ?? null },
      null,
    );

    if (args.decision === 'APPROVE') {
      if (this.ledger) {
        await this.ledger.markApproved({ approvalId: args.approvalId });
      }
      const payload = existing.requestedPayloadJson as { orderDrafts: unknown[] };
      const mappedRequests = (payload.orderDrafts as never[]).map((d) =>
        this.mapper.toUnifiedStageRequest(d as never),
      );
      await this.checkpoints.writeExecutionPayload({
        runId: existing.runId,
        payload: { orderDrafts: payload.orderDrafts, stageRequests: mappedRequests },
      });
      await this.completeApprovedRun({
        userId: args.userId,
        runId: existing.runId,
        executionPayload: { orderDrafts: payload.orderDrafts, stageRequests: mappedRequests },
      });

      if (this.autoDispatchFlag.enabled) {
        // Fetch the drafted ledger to pass ledgerId into commit metadata.
        const ledgerRow = await this.ledger?.getByApprovalId?.(existing.id);
        try {
          for (const req of mappedRequests) {
            await this.trading.stage(args.userId, req);
          }
          const committed = await this.trading.commit(
            args.userId,
            `auto:run ${existing.runId}`,
            { runId: existing.runId, ...(ledgerRow ? { ledgerId: ledgerRow.id } : {}) },
          );
          await this.ledger?.markCommitted({
            approvalId: existing.id,
            commitHash: committed.hash,
            operationRefs: mappedRequests.map((_, i) => `stage-${i}`),
          });
          await this.trading.execute(args.userId);
          await this.ledger?.markDispatched({
            approvalId: existing.id,
            executionResultRef: committed.hash,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.ledger?.markFailed({ approvalId: existing.id, note: message });
          // Don't revert the approval — the run is already marked complete.
          // Surface the dispatch failure via event log for operator follow-up.
          await this.events.append(
            args.userId,
            AgentEventAggregateType.ANALYSIS_APPROVAL,
            existing.id,
            AgentEventType.EXECUTION_REJECTED,
            { autoDispatchError: message },
            null,
          );
        }
      }
    } else {
      if (this.ledger) {
        await this.ledger.markRejected({ approvalId: args.approvalId, note: args.note });
      }
      // REJECT: cancel the run (should be WAITING_APPROVAL at this point).
      try {
        await this.runs.cancel(args.userId, existing.runId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('already')) throw err;
      }
    }
  }

  async listForRun(runId: string): Promise<ApprovalRow[]> {
    return (await this.db
      .select()
      .from(analysisApprovals)
      .where(eq(analysisApprovals.runId, runId))) as ApprovalRow[];
  }

  private async completeApprovedRun(args: {
    userId: string;
    runId: string;
    executionPayload: Record<string, unknown>;
  }): Promise<void> {
    if (!this.contextJournal || !this.reportAssembler) {
      await this.runs.markCompleted(args.userId, args.runId);
      return;
    }

    const sharedContext = await this.contextJournal.getRunContext(args.userId, args.runId);
    const stages = await this.runs.listStagesForRun(args.runId);
    const assembled = this.reportAssembler.build({
      sharedContext,
      stages: stages.map((stage) => ({
        stageKey: stage.stageKey,
        humanReportMarkdown: stage.humanReportMarkdown,
        structuredOutput: stage.structuredOutputJson,
      })),
      executionPayload: args.executionPayload,
    });
    await this.runs.completeWithOutputs({
      userId: args.userId,
      runId: args.runId,
      sharedContext,
      decisionObject: assembled.decisionObject,
      finalReportMarkdown: assembled.finalReportMarkdown,
    });
  }
}
