import { describe, it, expect, vi } from 'vitest';
import { extractStructuredJson } from '../role-executor.service';

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenAICompatibleModel: vi.fn(() => 'mock-model'),
  generateAgentText: vi
    .fn()
    .mockResolvedValue(
      '{"summary":"s","thesis":"t","risks":[],"openQuestions":[],"citations":[],"confidence":0.7}',
    ),
}));

describe('extractStructuredJson', () => {
  const payload = { summary: 'ok', confidence: 0.8, signals: [] };
  const json = JSON.stringify(payload);

  it('extracts from ```json fenced block', () => {
    const text = `Here is the analysis:\n\`\`\`json\n${json}\n\`\`\`\nEnd.`;
    expect(extractStructuredJson(text)).toEqual(payload);
  });

  it('extracts from unlabeled ``` fenced block', () => {
    const text = `prelude\n\`\`\`\n${json}\n\`\`\``;
    expect(extractStructuredJson(text)).toEqual(payload);
  });

  it('extracts bare JSON object with no fence', () => {
    const text = `Analysis follows. ${json} Done.`;
    expect(extractStructuredJson(text)).toEqual(payload);
  });

  it('extracts JSON even when response is pure JSON with whitespace', () => {
    expect(extractStructuredJson(`  \n${json}\n  `)).toEqual(payload);
  });

  it('prefers fenced JSON over bare JSON when both are present', () => {
    const fenced = { summary: 'fenced' };
    const bare = { summary: 'bare' };
    const text = `${JSON.stringify(bare)}\n\`\`\`json\n${JSON.stringify(fenced)}\n\`\`\``;
    expect(extractStructuredJson(text)).toEqual(fenced);
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractStructuredJson('no json here')).toThrow(/no JSON/i);
  });

  it('throws with a snippet of raw text when extraction fails', () => {
    const raw = 'this is a long message with nothing useful'.repeat(10);
    try {
      extractStructuredJson(raw);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/no JSON/i);
      expect((err as Error).message).toMatch(raw.slice(0, 40));
    }
  });

  it('falls through to brace scanner when ```json fence contains malformed JSON, and later bare JSON is valid', () => {
    const goodPayload = { summary: 'real' };
    const text = '```json\n{bad-json-here}\n```\nActual: ' + JSON.stringify(goodPayload);
    expect(extractStructuredJson(text)).toEqual(goodPayload);
  });

  it('extracts from unlabeled fence even when a malformed ```json fence exists earlier', () => {
    const goodPayload = { summary: 'unlabeled' };
    const text = '```json\n{broken\n```\n\n```\n' + JSON.stringify(goodPayload) + '\n```';
    expect(extractStructuredJson(text)).toEqual(goodPayload);
  });

  it('skips narrative-{placeholder} tokens and finds later valid JSON', () => {
    const payload = { key: 1 };
    const text = `Use {placeholder} here: ${JSON.stringify(payload)}`;
    expect(extractStructuredJson(text)).toEqual(payload);
  });
});
