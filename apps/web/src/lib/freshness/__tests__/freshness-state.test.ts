/**
 * PL-7 freshness-state.ts — pure threshold logic.
 * Table-driven tests at every boundary.
 */
import { describe, it, expect } from 'vitest';
import { computeFreshnessState } from '../freshness-state';
import { FRESHNESS_THRESHOLDS } from '../freshness-config';

const NOW = 1_700_000_000_000; // arbitrary fixed ms

describe('computeFreshnessState', () => {
  it('returns unknown when timestamp is null', () => {
    const r = computeFreshnessState({
      sourceTimestampMs: null,
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('unknown');
    expect(r.ageMs).toBeNull();
    expect(r.label).toMatch(/unknown/i);
  });

  it('returns unknown when timestamp is undefined', () => {
    const r = computeFreshnessState({
      sourceTimestampMs: undefined,
      nowMs: NOW,
      surface: 'news',
    });
    expect(r.state).toBe('unknown');
  });

  it('returns unknown when timestamp is NaN', () => {
    const r = computeFreshnessState({
      sourceTimestampMs: Number.NaN,
      nowMs: NOW,
      surface: 'news',
    });
    expect(r.state).toBe('unknown');
  });

  it('treats clock skew (future timestamp) as fresh, ageMs = 0', () => {
    const r = computeFreshnessState({
      sourceTimestampMs: NOW + 5_000,
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('fresh');
    expect(r.ageMs).toBe(0);
  });

  it('quote: at exactly freshWindowMs is fresh', () => {
    const fresh = FRESHNESS_THRESHOLDS.quote.freshWindowMs;
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - fresh,
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('fresh');
    expect(r.label).toBe('Live');
  });

  it('quote: 1ms past freshWindowMs is stale', () => {
    const fresh = FRESHNESS_THRESHOLDS.quote.freshWindowMs;
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - (fresh + 1),
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('stale');
    expect(r.label).toMatch(/min old/);
  });

  it('quote: at exactly staleWindowMs is stale', () => {
    const stale = FRESHNESS_THRESHOLDS.quote.staleWindowMs;
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - stale,
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('stale');
  });

  it('quote: 1ms past staleWindowMs is expired', () => {
    const stale = FRESHNESS_THRESHOLDS.quote.staleWindowMs;
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - (stale + 1),
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('expired');
    expect(r.label).toMatch(/old/i);
  });

  it('news: uses news label "Fresh" not "Live"', () => {
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - 1_000,
      nowMs: NOW,
      surface: 'news',
    });
    expect(r.state).toBe('fresh');
    expect(r.label).toBe('Fresh');
  });

  it('news: 7 hours old is expired (past 6h staleWindow)', () => {
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - 7 * 60 * 60_000,
      nowMs: NOW,
      surface: 'news',
    });
    expect(r.state).toBe('expired');
  });

  it('stale label contains rounded-down minutes (min 1)', () => {
    // 4 minutes old → "4 min old"
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - 4 * 60_000,
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('stale');
    expect(r.label).toBe('4 min old');
  });

  it('stale label minimum 1 minute (sub-minute stale rounds up to 1)', () => {
    // quote freshWindow=60s; 90s ago is stale
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - 90_000,
      nowMs: NOW,
      surface: 'quote',
    });
    expect(r.state).toBe('stale');
    expect(r.label).toBe('1 min old');
  });

  it('expired label humanizes age (hours / days)', () => {
    // 5 hours old, news surface: 5h > staleWindow 6h? no, 5h < 6h, so still stale.
    // Use 12h: definitely past 6h news stale window.
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - 12 * 60 * 60_000,
      nowMs: NOW,
      surface: 'news',
    });
    expect(r.state).toBe('expired');
    expect(r.label).toMatch(/12h/);
  });

  it('expired label uses days when over 24h', () => {
    const r = computeFreshnessState({
      sourceTimestampMs: NOW - 3 * 24 * 60 * 60_000,
      nowMs: NOW,
      surface: 'news',
    });
    expect(r.state).toBe('expired');
    expect(r.label).toMatch(/3d/);
  });

  it('color class differs per state', () => {
    const fresh = computeFreshnessState({
      sourceTimestampMs: NOW,
      nowMs: NOW,
      surface: 'quote',
    });
    const stale = computeFreshnessState({
      sourceTimestampMs: NOW - 90_000,
      nowMs: NOW,
      surface: 'quote',
    });
    const expired = computeFreshnessState({
      sourceTimestampMs: NOW - 60 * 60_000,
      nowMs: NOW,
      surface: 'quote',
    });
    const unknown = computeFreshnessState({
      sourceTimestampMs: null,
      nowMs: NOW,
      surface: 'quote',
    });
    const all = new Set([
      fresh.colorClass,
      stale.colorClass,
      expired.colorClass,
      unknown.colorClass,
    ]);
    expect(all.size).toBe(4);
  });
});
