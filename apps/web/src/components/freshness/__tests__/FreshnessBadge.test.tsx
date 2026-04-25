/**
 * PL-7 FreshnessBadge component tests.
 *
 * Pins:
 *   - renders all four states given matching sourceTimestampMs values
 *   - renders Unknown when sourceTimestampMs is null
 *   - aria-label mirrors visible label
 *   - logs exactly one structured event per render
 *   - role="status" + tabIndex 0 (focusable)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FreshnessBadge } from '../FreshnessBadge';

const NOW = new Date('2026-04-25T12:00:00Z').getTime();

describe('FreshnessBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders fresh state for a recent quote', () => {
    render(<FreshnessBadge surface="quote" sourceTimestampMs={NOW - 1_000} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('Live');
  });

  it('renders stale state for a 4-minute-old quote', () => {
    render(
      <FreshnessBadge surface="quote" sourceTimestampMs={NOW - 4 * 60_000} />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('4 min old');
  });

  it('renders expired state for a 12-hour-old news item', () => {
    render(
      <FreshnessBadge
        surface="news"
        sourceTimestampMs={NOW - 12 * 60 * 60_000}
      />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent?.toLowerCase()).toContain('old');
  });

  it('renders unknown when sourceTimestampMs is null', () => {
    render(<FreshnessBadge surface="quote" sourceTimestampMs={null} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent?.toLowerCase()).toContain('unknown');
  });

  it('aria-label mirrors visible text', () => {
    render(<FreshnessBadge surface="quote" sourceTimestampMs={NOW - 1_000} />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe(badge.textContent);
  });

  it('badge is keyboard focusable (tabIndex 0)', () => {
    render(<FreshnessBadge surface="quote" sourceTimestampMs={NOW} />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('tabindex')).toBe('0');
  });

  it('logs exactly one structured event per render', () => {
    const spy = vi.spyOn(console, 'info');
    render(<FreshnessBadge surface="quote" sourceTimestampMs={NOW - 1_000} />);
    const calls = spy.mock.calls.filter(
      (args) => args[0] === 'freshness.render',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      surface: 'quote',
      state: 'fresh',
    });
  });

  it('tooltip exposes the absolute ISO timestamp when known', () => {
    render(<FreshnessBadge surface="quote" sourceTimestampMs={NOW - 1_000} />);
    const badge = screen.getByRole('status');
    const title = badge.getAttribute('title') ?? '';
    expect(title).toContain(new Date(NOW - 1_000).toISOString());
  });
});
