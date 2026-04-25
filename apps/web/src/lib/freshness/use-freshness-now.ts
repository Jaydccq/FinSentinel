'use client';

/**
 * PL-7 useFreshnessNow — returns a `Date.now()` value that ticks while the
 * tab is visible and freezes when hidden. On returning to visible, snaps
 * immediately so the badge does not show a stale "Live" after a long hide.
 *
 * Tick interval is fixed at 60s — the tightest fresh window in the spec is
 * 60s (quote), so a 60s interval guarantees we see at most one tick of
 * staleness lag before the badge transitions states.
 */
import { useEffect, useState } from 'react';

const TICK_INTERVAL_MS = 60_000;

function isVisible(): boolean {
  // SSR-safe: assume visible if document is missing.
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

export function useFreshnessNow(): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startTicking = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    };
    const stopTicking = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibilityChange = () => {
      if (isVisible()) {
        // Snap to "now" immediately; do not wait for the next interval tick.
        setNow(Date.now());
        startTicking();
      } else {
        stopTicking();
      }
    };

    if (isVisible()) {
      startTicking();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopTicking();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return now;
}
