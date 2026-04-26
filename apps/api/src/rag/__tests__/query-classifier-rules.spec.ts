import { describe, it, expect } from 'vitest';
import { classifyByRules } from '../query-classifier-rules';

describe('classifyByRules', () => {
  // ── exact_lookup ──────────────────────────────────────────────────────────

  it.each([
    ['AAPL Q4 2025 EPS', 'whitelisted ticker + time anchor'],
    ['Item 1A risk factors', 'section identifier'],
    ['Note 15 derivative instruments', 'note identifier'],
    ['Section 2.1 of the agreement', 'section identifier'],
    ['What does ISIN US0378331005 mean?', 'numeric identifier'],
    ['EPS for FY2025', 'numeric identifier'],
    ['"net sales" earnings', 'quoted phrase'],
    ['XYZ Q4 2025 revenue', 'triple-gate fallback'],
  ])('classifies "%s" as exact_lookup (%s)', (q) => {
    const result = classifyByRules(q);
    expect(result.class).toBe('exact_lookup');
    expect(result.confidence).toBe(1.0);
  });

  it('does NOT classify bare "THE Q4 2025" as exact_lookup', () => {
    expect(classifyByRules('THE Q4 2025').class).not.toBe('exact_lookup');
  });

  it('regression: every exact_lookup classification has confidence === 1.0', () => {
    const samples = [
      'AAPL Q4 2025 EPS',
      'Item 1A risk factors',
      '"net sales" earnings',
      'XYZ Q4 2025 revenue',
    ];
    for (const q of samples) {
      const r = classifyByRules(q);
      if (r.class === 'exact_lookup') {
        expect(r.confidence).toBe(1.0);
      }
    }
  });

  // ── multi_part ────────────────────────────────────────────────────────────

  it.each([
    'What is Apple revenue? What is the operating margin?',
    'What is Tesla revenue and what is the operating margin?',
  ])('classifies "%s" as multi_part', (q) => {
    expect(classifyByRules(q).class).toBe('multi_part');
  });

  // ── analytical ────────────────────────────────────────────────────────────

  it.each([
    'compare Apple and Microsoft margins',
    'analyze the impact of tariffs',
    'explain the revenue driver',
    'summarize the outlook',
  ])('classifies "%s" as analytical (keyword)', (q) => {
    const r = classifyByRules(q);
    expect(r.class).toBe('analytical');
    expect(r.confidence).toBe(1.0);
  });

  it('classifies a >120-char query as analytical (length fallback)', () => {
    const long =
      'I would like to understand the broader macroeconomic environment and how it affects the technology sector valuations going into next year please.';
    expect(long.length).toBeGreaterThan(120);
    const r = classifyByRules(long);
    expect(r.class).toBe('analytical');
    expect(r.confidence).toBe(0.5);
  });

  // ── relational ────────────────────────────────────────────────────────────

  it.each([
    'who are competitors of Tesla',
    'which companies are suppliers of Apple',
    'how is Microsoft connected to OpenAI',
    'CEO of Nvidia',
  ])('classifies "%s" as relational', (q) => {
    expect(classifyByRules(q).class).toBe('relational');
  });

  // ── colloquial ────────────────────────────────────────────────────────────

  it.each(['hi', 'hello', 'thanks!', 'got it', 'bye', 'help me'])(
    'classifies "%s" as colloquial',
    (q) => {
      expect(classifyByRules(q).class).toBe('colloquial');
    },
  );

  it('precedence: bare "AAPL" alone is factoid, not colloquial', () => {
    // No time anchor → not exact_lookup; not in colloquial regex → falls
    // through to factoid.
    const r = classifyByRules('AAPL');
    expect(r.class).toBe('factoid');
  });

  // ── factoid ───────────────────────────────────────────────────────────────

  it('classifies plain factoid query', () => {
    const r = classifyByRules('What is the current Apple revenue?');
    expect(r.class).toBe('factoid');
    expect(r.confidence).toBe(0.4);
    expect(r.rule).toBe('fallback');
  });

  // ── precedence regression ────────────────────────────────────────────────

  it('precedence: exact_lookup beats analytical keyword', () => {
    // Has "risk" (analytical_keyword) AND a section identifier (exact_lookup).
    // exact_lookup must win.
    const r = classifyByRules('Item 1A risk factors');
    expect(r.class).toBe('exact_lookup');
  });
});
