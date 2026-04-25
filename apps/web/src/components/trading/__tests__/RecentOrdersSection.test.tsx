import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { RecentOrdersSection } from '../RecentOrdersSection';
import { tradingLedgerApi } from '../../../api/trading';
import type { OrderLedgerListResponse } from '@finsentinel/shared';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const baseRow = {
  id: 'lg-1',
  commitHash: 'abc',
  status: 'EXECUTED' as const,
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
};

describe('RecentOrdersSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders rows of varying status returned by the hook', async () => {
    const rows: OrderLedgerListResponse = [
      baseRow,
      { ...baseRow, id: 'lg-2', symbol: 'TSLA', status: 'FAILED', errorReason: 'rejected' },
      { ...baseRow, id: 'lg-3', symbol: 'GOOG', status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' },
    ];
    vi.spyOn(tradingLedgerApi, 'list').mockResolvedValueOnce(rows);

    render(<RecentOrdersSection />, { wrapper });

    await waitFor(() => {
      expect(screen.getAllByTestId('order-ledger-card')).toHaveLength(3);
    });
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('TSLA')).toBeTruthy();
    expect(screen.getByText('GOOG')).toBeTruthy();
    expect(screen.getByText(/rejected/i)).toBeTruthy();
  });

  it('shows the empty state when there are no rows', async () => {
    vi.spyOn(tradingLedgerApi, 'list').mockResolvedValueOnce([]);

    render(<RecentOrdersSection />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/no orders yet/i)).toBeTruthy();
    });
  });
});
