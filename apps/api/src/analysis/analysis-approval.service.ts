import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
import { OrderDraftMapper } from '../trading/order-draft-mapper.service';

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
  ) {}

  async request(args: {
    userId: string;
    runId: string;
    payload: OrderDraftsPayload;
  }): Promise<ApprovalRow> {
    const parsed = orderDraftsPayloadSchema.parse(args.payload);
    const [row] = await this.db
      .insert(analysisApprovals)
      .values({
        runId: args.runId,
        approvalType: 'EXECUTION_APPROVAL',
        status: 'PENDING',
        requestedPayloadJson: parsed as unknown as Record<string, unknown>,
      })
      .returning();
    const created = row as ApprovalRow;
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      created.id,
      AgentEventType.EXECUTION_APPROVAL_REQUIRED,
      { runId: args.runId, draftCount: parsed.orderDrafts.length },
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
      const payload = existing.requestedPayloadJson as { orderDrafts: unknown[] };
      const mappedRequests = (payload.orderDrafts as never[]).map((d) =>
        this.mapper.toUnifiedStageRequest(d as never),
      );
      await this.checkpoints.writeExecutionPayload({
        runId: existing.runId,
        payload: { orderDrafts: payload.orderDrafts, stageRequests: mappedRequests },
      });
      await this.runs.markCompleted(args.userId, existing.runId);
    } else {
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
}
