import { describe, it, expect, beforeEach } from 'vitest';
import { TextCleaningService } from '../text-cleaning.service';

describe('TextCleaningService', () => {
  let service: TextCleaningService;

  beforeEach(() => {
    service = new TextCleaningService();
  });

  // ── Null / empty handling ───────────────────────────────────────────────

  it('returns empty string for empty input', () => {
    expect(service.clean('')).toBe('');
  });

  it('returns empty string for null/undefined input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(service.clean(null as any)).toBe('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(service.clean(undefined as any)).toBe('');
  });

  // ── Null byte removal ──────────────────────────────────────────────────

  it('removes null bytes', () => {
    expect(service.clean('hello\0world')).toBe('helloworld');
    expect(service.clean('\0\0test\0')).toBe('test');
  });

  // ── Control character stripping ────────────────────────────────────────

  it('strips control characters except newlines and tabs', () => {
    // \x01 = SOH, \x02 = STX, \x1F = US — all should be removed
    expect(service.clean('hello\x01\x02world')).toBe('helloworld');
    expect(service.clean('test\x1Fdata')).toBe('testdata');
  });

  it('preserves newlines and tabs', () => {
    expect(service.clean('line1\nline2')).toBe('line1\nline2');
    expect(service.clean('col1\tcol2')).toBe('col1 col2');
  });

  // ── Unicode normalization ──────────────────────────────────────────────

  it('normalizes unicode single quotes to ASCII', () => {
    expect(service.clean('\u2018hello\u2019')).toBe("'hello'");
    expect(service.clean('\u201Atest\u201B')).toBe("'test'");
  });

  it('normalizes unicode double quotes to ASCII', () => {
    expect(service.clean('\u201Chello\u201D')).toBe('"hello"');
    expect(service.clean('\u201Etest\u201F')).toBe('"test"');
  });

  it('normalizes en-dash and em-dash to hyphen', () => {
    expect(service.clean('2020\u20132023')).toBe('2020-2023');
    expect(service.clean('hello\u2014world')).toBe('hello-world');
  });

  it('normalizes ellipsis to three dots', () => {
    expect(service.clean('wait\u2026')).toBe('wait...');
  });

  // ── Whitespace collapsing ──────────────────────────────────────────────

  it('collapses multiple spaces into single space', () => {
    expect(service.clean('hello   world')).toBe('hello world');
    expect(service.clean('a     b     c')).toBe('a b c');
  });

  it('trims leading and trailing whitespace per line', () => {
    expect(service.clean('  hello  \n  world  ')).toBe('hello\nworld');
  });

  // ── Paragraph boundary normalization ───────────────────────────────────

  it('collapses 3+ newlines into exactly 2', () => {
    expect(service.clean('para1\n\n\npara2')).toBe('para1\n\npara2');
    expect(service.clean('para1\n\n\n\n\npara2')).toBe('para1\n\npara2');
  });

  it('preserves double newlines (paragraph separators)', () => {
    expect(service.clean('para1\n\npara2')).toBe('para1\n\npara2');
  });

  // ── Full pipeline ─────────────────────────────────────────────────────

  it('applies all cleaning steps together', () => {
    const dirty = '  \0Hello\x01 \u201Cworld\u201D   \n\n\n\n  It\u2019s   a   test\u2026  ';
    const cleaned = service.clean(dirty);

    expect(cleaned).toBe('Hello "world"\n\nIt\'s a test...');
  });

  it('handles realistic SEC filing text', () => {
    const filing = [
      '  FORM 10-K   ',
      '',
      '',
      '',
      '  Annual Report\0   ',
      '  Filed: 2024\u201301\u201315  ',
      '  Revenue:   $1,234,567  ',
    ].join('\n');

    const cleaned = service.clean(filing);
    expect(cleaned).toContain('FORM 10-K');
    expect(cleaned).toContain('Annual Report');
    expect(cleaned).toContain('2024-01-15');
    expect(cleaned).not.toContain('\0');
    // No triple+ newlines
    expect(cleaned).not.toMatch(/\n{3,}/);
  });
});
