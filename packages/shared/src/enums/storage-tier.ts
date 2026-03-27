export const StorageTier = {
  HOT: 'HOT',
  COLD: 'COLD',
  DELETED: 'DELETED',
} as const;

export type StorageTier = (typeof StorageTier)[keyof typeof StorageTier];
