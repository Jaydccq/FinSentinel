import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { useOrderLedgerUnknown } from '../use-order-ledger-unknown';
import { tradingLedgerApi } from '../../../api/trading';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('useOrderLedgerUnknown', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns UNKNOWN ledger rows from tradingLedgerApi.unknown()', async () => {
    const spy = vi.spyOn(tradingLedgerApi, 'unknown').mockResolvedValueOnce([
      {
        id: 'lg-unknown-1',
        commitHash: 'abc',
        status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
        symbol: 'AAPL',
        side: 'buy',
        qty: '10',
        amount: null,
        price: null,
        broker: 'paper',
        brokerOrderId: null,
        errorReason: 'broker timeout',
        createdAt: '2026-04-26T01:00:00Z',
        updatedAt: '2026-04-26T01:00:00Z',
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementNote: null,
      },
    ]);
    const { result } = renderHook(() => useOrderLedgerUnknown(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.status).toBe('UNKNOWN_REQUIRES_OPERATOR_REVIEW');
    expect(result.current.data?.[0]?.acknowledgedAt).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('surfaces fetch errors via SWR error state', async () => {
    vi.spyOn(tradingLedgerApi, 'unknown').mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useOrderLedgerUnknown(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect((result.current.error as Error).message).toBe('boom');
  });

  it('exposes a stable cache key for mutate() invalidation', () => {
    expect(useOrderLedgerUnknown.key).toEqual(['trading', 'ledger-unknown']);
  });
});
