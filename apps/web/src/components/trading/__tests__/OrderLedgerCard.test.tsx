import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderLedgerCard } from '../OrderLedgerCard';
import type { OrderLedgerRowResponse } from '@finsentinel/shared';

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

  it('renders a disabled Acknowledge button for UNKNOWN_REQUIRES_OPERATOR_REVIEW', () => {
    render(<OrderLedgerCard row={{ ...baseRow, status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' }} />);
    const btn = screen.getByRole('button', { name: /acknowledge/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/phase 2/i);
  });

  it('does not render an action button for EXECUTED rows', () => {
    render(<OrderLedgerCard row={baseRow} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
