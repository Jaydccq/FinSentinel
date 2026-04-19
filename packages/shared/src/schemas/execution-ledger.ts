import { z } from 'zod';

export const executionReviewLedgerStatusSchema = z.enum([
  'DRAFTED',
  'STAGED',
  'COMMITTED',
  'APPROVED',
  'DISPATCHED',
  'EXECUTED',
  'REJECTED',
  'FAILED',
]);
export type ExecutionReviewLedgerStatus = z.infer<typeof executionReviewLedgerStatusSchema>;

export const executionReviewLedgerSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  approvalId: z.string().uuid(),
  status: executionReviewLedgerStatusSchema,
  orderDraftRefs: z.array(z.string()),
  stagedOperationRefs: z.array(z.string()),
  commitHash: z.string().nullable(),
  executionResultRef: z.string().nullable(),
  rejectionNote: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExecutionReviewLedger = z.infer<typeof executionReviewLedgerSchema>;
