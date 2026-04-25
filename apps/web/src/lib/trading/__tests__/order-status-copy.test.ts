import { describe, it, expect } from 'vitest';
import { ORDER_STATUS_COPY, orderStatusCopy } from '../order-status-copy';

describe('order status copy', () => {
  it('exposes a copy entry for every known status', () => {
    const required = [
      'STAGED',
      'COMMITTED',
      'EXECUTING',
      'EXECUTED',
      'PARTIALLY_FAILED',
      'FAILED',
      'CANCELLED',
      'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
    ] as const;
    for (const s of required) {
      expect(ORDER_STATUS_COPY[s]).toBeDefined();
      expect(ORDER_STATUS_COPY[s].label.length).toBeGreaterThan(0);
      expect(ORDER_STATUS_COPY[s].colorClass.length).toBeGreaterThan(0);
    }
  });

  it('falls back to a safe default for unknown values', () => {
    const c = orderStatusCopy('totally_made_up');
    expect(c.label).toBe('Unknown');
    expect(c.iconHint).toBe('alert');
  });

  it('returns the canonical entry for known values via lookup helper', () => {
    expect(orderStatusCopy('EXECUTED').label).toBe('Executed');
    expect(orderStatusCopy('UNKNOWN_REQUIRES_OPERATOR_REVIEW').label).toBe('Unknown — review');
  });
});
