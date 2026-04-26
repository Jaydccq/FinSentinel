import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { OrderLedgerCard } from '../OrderLedgerCard';
import { tradingLedgerApi } from '../../../api/trading';
import type { OrderLedgerRowResponse } from '@finsentinel/shared';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

const baseRow: OrderLedgerRowResponse = {
  id: 'lg-1',
  commitHash: 'abc',
  status: 'EXECUTED',
  symbol: 'AAPL',
  side: 'buy',
  qty: '100',
  amount: null,
  price: '15.20',
  broker: 'paper',
  brokerOrderId: null,
  errorReason: null,
  createdAt: '2026-04-25T12:00:00Z',
  updatedAt: '2026-04-25T12:00:05Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgementNote: null,
};

describe('OrderLedgerCard', () => {
  it('renders broker, side, and the status badge', () => {
    render(<OrderLedgerCard row={baseRow} />);
    expect(screen.getByText('paper')).toBeTruthy();
    expect(screen.getByText('buy')).toBeTruthy();
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('EXECUTED');
  });

  it('renders the fill ratio using filledQty when provided', () => {
    render(<OrderLedgerCard row={{ ...baseRow, status: 'PARTIALLY_FAILED' }} filledQty="40" />);
    expect(screen.getByText('40 / 100')).toBeTruthy();
  });

  it('shows the error reason when present', () => {
    render(
      <OrderLedgerCard
        row={{ ...baseRow, status: 'FAILED', errorReason: 'broker rejected' }}
      />,
    );
    expect(screen.getByText(/broker rejected/i)).toBeTruthy();
  });

  it('renders a disabled Retry button for FAILED with the phase-2 tooltip', () => {
    render(<OrderLedgerCard row={{ ...baseRow, status: 'FAILED' }} />);
    const btn = screen.getByRole('button', { name: /retry/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/phase 2/i);
  });

  it('renders an enabled Acknowledge button for UNKNOWN rows that are not yet ack’d', () => {
    render(
      <OrderLedgerCard row={{ ...baseRow, status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' }} />,
      { wrapper },
    );
    const btn = screen.getByRole('button', { name: /acknowledge/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('opens the Acknowledge modal on click and submits the note via tradingLedgerApi.acknowledge', async () => {
    const ackSpy = vi.spyOn(tradingLedgerApi, 'acknowledge').mockResolvedValueOnce({
      ...baseRow,
      id: 'lg-1',
      status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
      acknowledgedAt: '2026-04-26T02:00:00Z',
      acknowledgedBy: 'aabbccdd-1111-2222-3333-444455556666',
      acknowledgementNote: 'verified',
    });

    render(
      <OrderLedgerCard row={{ ...baseRow, status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' }} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    const ta = screen.getByLabelText(/Acknowledgement note/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'verified' } });
    fireEvent.click(
      screen.getAllByRole('button', { name: /acknowledge/i })[1] as HTMLButtonElement,
    );
    await waitFor(() => {
      expect(ackSpy).toHaveBeenCalledWith('lg-1', { note: 'verified' });
    });
  });

  it('shows the acknowledged metadata + (ack’d) badge suffix when row is ack’d', () => {
    render(
      <OrderLedgerCard
        row={{
          ...baseRow,
          status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
          acknowledgedAt: '2026-04-26T02:00:00Z',
          acknowledgedBy: 'aabbccdd-1111-2222-3333-444455556666',
          acknowledgementNote: 'verified with broker',
        }}
      />,
      { wrapper },
    );
    // No active button.
    expect(screen.queryByRole('button', { name: /acknowledge/i })).toBeNull();
    // Ack metadata is rendered.
    expect(screen.getByTestId('ack-meta').textContent).toMatch(/acknowledged/i);
    expect(screen.getByTestId('ack-meta').textContent).toMatch(/verified with broker/);
    // Badge suffix.
    expect(screen.getByRole('status').getAttribute('data-acknowledged')).toBe('true');
    expect(screen.getByRole('status').textContent).toMatch(/ack'd/);
  });

  it('does not render an action button for EXECUTED rows', () => {
    render(<OrderLedgerCard row={baseRow} />, { wrapper });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
