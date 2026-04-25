/**
 * PL-7 useFreshnessNow — visibility-aware ticker.
 *
 * Verifies:
 *   - hook returns initial Date.now()
 *   - ticks advance under fake timers while visible
 *   - hidden tab freezes ticks
 *   - returning to visible ticks immediately and resumes interval
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useFreshnessNow } from '../use-freshness-now';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useFreshnessNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
    vi.setSystemTime(new Date('2026-04-25T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current Date.now() on mount', () => {
    const { result } = renderHook(() => useFreshnessNow());
    expect(result.current).toBe(Date.now());
  });

  it('advances when the interval fires', () => {
    const { result } = renderHook(() => useFreshnessNow());
    const initial = result.current;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBeGreaterThan(initial);
    expect(result.current).toBe(initial + 60_000);
  });

  it('freezes the tick when the tab becomes hidden', () => {
    const { result } = renderHook(() => useFreshnessNow());
    const initial = result.current;

    act(() => {
      setVisibility('hidden');
    });
    // Advance system time AND timer queue. Without a tick, `now` should not move.
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current).toBe(initial);
  });

  it('ticks immediately on returning to visible and resumes interval', () => {
    const { result } = renderHook(() => useFreshnessNow());
    const initial = result.current;

    act(() => {
      setVisibility('hidden');
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current).toBe(initial);

    // Time has actually moved forward in the system clock; coming back to
    // visible should snap `now` to the current Date.now().
    act(() => {
      setVisibility('visible');
    });
    expect(result.current).toBe(initial + 120_000);

    // And ticks should resume.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(initial + 180_000);
  });
});
