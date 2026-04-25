import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderStatusBadge } from '../OrderStatusBadge';

describe('OrderStatusBadge', () => {
  it('renders the EXECUTED label and exposes the status as data-status', () => {
    render(<OrderStatusBadge status="EXECUTED" />);
    expect(screen.getByText('Executed')).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('data-status')).toBe('EXECUTED');
  });

  it('renders Unknown for an enum value the UI does not recognize', () => {
    render(<OrderStatusBadge status="BIZARRE_NEW_ENUM" />);
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('renders the operator-review status with its emphasized label', () => {
    render(<OrderStatusBadge status="UNKNOWN_REQUIRES_OPERATOR_REVIEW" />);
    expect(screen.getByText('Unknown — review')).toBeTruthy();
  });
});
