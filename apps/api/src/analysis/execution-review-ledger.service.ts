import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { executionReviewLedgers } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

type LedgerRow = {
  id: string;
  runId: string;
  approvalId: string;
  status: string;
  orderDraftRefs: string[];
  stagedOperationRefs: string[];
  commitHash: string | null;
  executionResultRef: string | null;
  rejectionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ExecutionReviewLedgerService {
  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  async createDraft(args: { runId: string; approvalId: string; orderDraftRefs: string[] }): Promise<LedgerRow> {
    // Every nullable column explicit — Postgres.js mixed-default bind bug.
    const now = new Date();
    const [row] = await this.db
      .insert(executionReviewLedgers)
      .values({
        id: randomUUID(),
        runId: args.runId,
        approvalId: args.approvalId,
        status: 'DRAFTED',
        orderDraftRefs: args.orderDraftRefs,
        stagedOperationRefs: [],
        commitHash: null,
        executionResultRef: null,
        rejectionNote: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row as LedgerRow;
  }

  async markApproved(args: { approvalId: string }): Promise<void> {
    await this.db
      .update(executionReviewLedgers)
      .set({ status: 'APPROVED', updatedAt: new Date() })
      .where(eq(executionReviewLedgers.approvalId, args.approvalId));
  }

  async markRejected(args: { approvalId: string; note?: string }): Promise<void> {
    await this.db
      .update(executionReviewLedgers)
      .set({
        status: 'REJECTED',
        rejectionNote: args.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(executionReviewLedgers.approvalId, args.approvalId));
  }

  async markCommitted(args: { approvalId: string; commitHash: string; operationRefs: string[] }): Promise<void> {
    await this.db
      .update(executionReviewLedgers)
      .set({
        status: 'COMMITTED',
        commitHash: args.commitHash,
        stagedOperationRefs: args.operationRefs,
        updatedAt: new Date(),
      })
      .where(eq(executionReviewLedgers.approvalId, args.approvalId));
  }

  async markDispatched(args: { approvalId: string; executionResultRef: string }): Promise<void> {
    await this.db
      .update(executionReviewLedgers)
      .set({
        status: 'EXECUTED',
        executionResultRef: args.executionResultRef,
        updatedAt: new Date(),
      })
      .where(eq(executionReviewLedgers.approvalId, args.approvalId));
  }

  async markFailed(args: { approvalId: string; note: string }): Promise<void> {
    await this.db
      .update(executionReviewLedgers)
      .set({
        status: 'FAILED',
        rejectionNote: args.note,
        updatedAt: new Date(),
      })
      .where(eq(executionReviewLedgers.approvalId, args.approvalId));
  }

  async getByApprovalId(approvalId: string): Promise<LedgerRow | null> {
    const [row] = await this.db
      .select()
      .from(executionReviewLedgers)
      .where(eq(executionReviewLedgers.approvalId, approvalId))
      .limit(1);
    return (row as LedgerRow | undefined) ?? null;
  }

  async listForRun(runId: string): Promise<LedgerRow[]> {
    const rows = await this.db
      .select()
      .from(executionReviewLedgers)
      .where(eq(executionReviewLedgers.runId, runId));
    return rows as LedgerRow[];
  }
}
