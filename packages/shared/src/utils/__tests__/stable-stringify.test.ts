import { describe, it, expect } from 'vitest';
import { stableStringify } from '../stable-stringify';

describe('stableStringify', () => {
  it('produces same output regardless of key insertion order', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('recurses into nested objects', () => {
    const a = stableStringify({ x: { z: 3, y: 2 } });
    const b = stableStringify({ x: { y: 2, z: 3 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('s')).toBe('"s"');
  });

  it('matches JSON.stringify shape for canonical input', () => {
    const obj = { a: 1, b: [{ c: 2, d: 3 }] };
    const expected = JSON.stringify({ a: 1, b: [{ c: 2, d: 3 }] });
    expect(stableStringify(obj)).toBe(expected);
  });
});
