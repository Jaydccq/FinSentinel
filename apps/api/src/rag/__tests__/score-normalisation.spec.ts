import { describe, it, expect } from 'vitest';
import { normaliseRerankScore, clampUnit } from '../score-normalisation';

describe('normaliseRerankScore (sigmoid)', () => {
  it('maps 0 to 0.5 (sigmoid identity at origin)', () => {
    expect(normaliseRerankScore(0)).toBe(0.5);
  });

  it('is strictly monotonic for a range of inputs', () => {
    const samples = [-10, -5, -1, -0.5, 0, 0.5, 1, 5, 10];
    const outputs = samples.map((s) => normaliseRerankScore(s));
    for (let i = 0; i < outputs.length - 1; i++) {
      expect(outputs[i]!).toBeLessThan(outputs[i + 1]!);
    }
  });

  it('is strictly in (0, 1) for realistic reranker-score magnitudes', () => {
    // BGE-style cross-encoders typically return scores in roughly [-10, +10].
    for (const x of [-10, -1, 0, 1, 10]) {
      const y = normaliseRerankScore(x);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
  });

  it('is bounded in [0, 1] for extreme inputs (saturation)', () => {
    for (const x of [-1000, -50, 50, 1000]) {
      const y = normaliseRerankScore(x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('saturates to near-1 for very large positive inputs without NaN/Infinity', () => {
    const y = normaliseRerankScore(50);
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeGreaterThan(0.99);
    expect(y).toBeLessThanOrEqual(1);
  });

  it('saturates to near-0 for very large negative inputs without NaN/Infinity', () => {
    const y = normaliseRerankScore(-50);
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(0.01);
  });
});

describe('clampUnit', () => {
  it('passes through values in [0, 1] unchanged', () => {
    expect(clampUnit(0)).toBe(0);
    expect(clampUnit(0.5)).toBe(0.5);
    expect(clampUnit(1)).toBe(1);
  });

  it('clamps negatives to 0', () => {
    expect(clampUnit(-0.1)).toBe(0);
    expect(clampUnit(-100)).toBe(0);
  });

  it('clamps > 1 to 1', () => {
    expect(clampUnit(1.01)).toBe(1);
    expect(clampUnit(100)).toBe(1);
  });

  it('preserves monotonicity within the valid range', () => {
    const xs = [0, 0.1, 0.25, 0.5, 0.75, 1.0];
    const ys = xs.map(clampUnit);
    for (let i = 0; i < ys.length - 1; i++) {
      expect(ys[i]!).toBeLessThanOrEqual(ys[i + 1]!);
    }
  });
});
