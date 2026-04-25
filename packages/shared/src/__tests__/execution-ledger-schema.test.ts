import { describe, expect, it } from 'vitest';
import {
  executionReviewLedgerSchema,
  executionReviewLedgerStatusSchema,
} from '../schemas/execution-ledger';

describe('executionReviewLedgerSchema', () => {
  it('parses a staged ledger record', () => {
    const parsed = executionReviewLedgerSchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      runId: '22222222-2222-2222-2222-222222222222',
      approvalId: '33333333-3333-3333-3333-333333333333',
      status: 'STAGED',
      orderDraftRefs: ['artifact-1'],
      stagedOperationRefs: ['op-1'],
      commitHash: null,
      executionResultRef: null,
      rejectionNote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.status).toBe('STAGED');
  });

  it('accepts all eight lifecycle statuses', () => {
    for (const status of [
      'DRAFTED',
      'STAGED',
      'COMMITTED',
      'APPROVED',
      'DISPATCHED',
      'EXECUTED',
      'REJECTED',
      'FAILED',
    ]) {
      expect(executionReviewLedgerStatusSchema.parse(status)).toBe(status);
    }
  });
});
