/**
 * PL-7 freshness state derivation — pure function.
 *
 * Given a source timestamp (ms since epoch), the current time, and a surface,
 * return the freshness state plus presentation hints (label, Tailwind color
 * class). The component layer renders this directly; no side effects here.
 */
import {
  FRESHNESS_THRESHOLDS,
  type FreshnessSurface,
} from './freshness-config';

export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'unknown';

export interface FreshnessResult {
  state: FreshnessState;
  ageMs: number | null;
  label: string;
  colorClass: string;
  surface: FreshnessSurface;
}

const COLOR_BY_STATE: Record<FreshnessState, string> = {
  fresh: 'bg-green-100 text-green-800',
  stale: 'bg-amber-100 text-amber-800',
  expired: 'bg-red-100 text-red-800',
  unknown: 'bg-gray-100 text-gray-700',
};

function freshLabel(surface: FreshnessSurface): string {
  // Quote shows "Live" because the price stream is canonical "right-now"
  // data; the other surfaces use "Fresh" which is the more honest copy.
  return surface === 'quote' ? 'Live' : 'Fresh';
}

function staleLabel(ageMs: number): string {
  // Round down minutes; minimum 1 (a sub-minute "stale" can happen on
  // quote where freshWindow is 60s — show "1 min old" rather than "0").
  const minutes = Math.max(1, Math.floor(ageMs / 60_000));
  return `${minutes} min old`;
}

function humanizeAge(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function expiredLabel(ageMs: number): string {
  return `Old (${humanizeAge(ageMs)})`;
}

export function computeFreshnessState(args: {
  sourceTimestampMs: number | null | undefined;
  nowMs: number;
  surface: FreshnessSurface;
}): FreshnessResult {
  const { sourceTimestampMs, nowMs, surface } = args;

  if (
    sourceTimestampMs === null ||
    sourceTimestampMs === undefined ||
    Number.isNaN(sourceTimestampMs)
  ) {
    return {
      state: 'unknown',
      ageMs: null,
      label: 'Unknown',
      colorClass: COLOR_BY_STATE.unknown,
      surface,
    };
  }

  // Clock skew: source claims to be from the future. Treat as fresh / age 0
  // rather than displaying a negative age that confuses users.
  const rawAge = nowMs - sourceTimestampMs;
  const ageMs = rawAge < 0 ? 0 : rawAge;

  const { freshWindowMs, staleWindowMs } = FRESHNESS_THRESHOLDS[surface];

  if (ageMs <= freshWindowMs) {
    return {
      state: 'fresh',
      ageMs,
      label: freshLabel(surface),
      colorClass: COLOR_BY_STATE.fresh,
      surface,
    };
  }
  if (ageMs <= staleWindowMs) {
    return {
      state: 'stale',
      ageMs,
      label: staleLabel(ageMs),
      colorClass: COLOR_BY_STATE.stale,
      surface,
    };
  }
  return {
    state: 'expired',
    ageMs,
    label: expiredLabel(ageMs),
    colorClass: COLOR_BY_STATE.expired,
    surface,
  };
}
