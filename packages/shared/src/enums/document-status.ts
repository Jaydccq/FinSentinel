export const DocumentStatus = {
  /**
   * F-4 outbox step 1: row exists, storage upload hasn't happened yet.
   * A reconciler (future work) finds rows stuck here and either cleans
   * them up or promotes them to `PENDING` once storage confirms the key.
   */
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];
