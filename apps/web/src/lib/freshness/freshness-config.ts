/**
 * PL-7 freshness badge — per-surface thresholds.
 *
 * Single source of truth for how recent a piece of data must be before it
 * downgrades from "fresh" to "stale" to "expired". Surfaces that are not
 * yet wired in v1 (citation, holdings) are still listed so phase 2 can
 * adopt them without reopening this file.
 */
export type FreshnessSurface = 'quote' | 'news' | 'citation' | 'holdings';

export interface FreshnessThresholds {
  freshWindowMs: number;
  staleWindowMs: number;
}

export const FRESHNESS_THRESHOLDS: Record<FreshnessSurface, FreshnessThresholds> = {
  quote: { freshWindowMs: 60_000, staleWindowMs: 5 * 60_000 },
  news: { freshWindowMs: 15 * 60_000, staleWindowMs: 6 * 60 * 60_000 },
  citation: { freshWindowMs: 24 * 60 * 60_000, staleWindowMs: 7 * 24 * 60 * 60_000 },
  holdings: { freshWindowMs: 5 * 60_000, staleWindowMs: 30 * 60_000 },
};
