import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { useOrderLedger } from '../use-order-ledger';
import { tradingLedgerApi } from '../../../api/trading';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('useOrderLedger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ledger rows from the trading API', async () => {
    const spy = vi.spyOn(tradingLedgerApi, 'list').mockResolvedValueOnce([
      {
        id: 'lg-1',
        commitHash: 'abc',
        status: 'EXECUTED',
        symbol: 'AAPL',
        side: 'buy',
        qty: '10',
        amount: null,
        price: '150.00',
        broker: 'paper',
        brokerOrderId: null,
        errorReason: null,
        createdAt: '2026-04-25T12:00:00Z',
        updatedAt: '2026-04-25T12:00:05Z',
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementNote: null,
      },
    ]);
    const { result } = renderHook(() => useOrderLedger(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.status).toBe('EXECUTED');
    expect(spy).toHaveBeenCalledOnce();
  });
});
