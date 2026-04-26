import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  LlmQueryClassifierService,
  parseLlmResponse,
  buildClassifierPrompt,
  QUERY_CLASSIFIER_SYSTEM_PROMPT,
  QUERY_CLASSIFIER_FEW_SHOT,
} from '../query-classifier-llm';
import { aiConfig } from '../../config/ai.config';

const generateAgentTextMock = vi.fn();

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenAICompatibleModel: vi.fn(() => 'mock-model'),
  generateAgentText: (args: unknown) => generateAgentTextMock(args),
}));

const mockAiConfig = {
  provider: 'openrouter' as const,
  apiKey: 'test-key',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash-preview',
  openrouterApiKey: 'test-key',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
};

describe('LlmQueryClassifierService', () => {
  let service: LlmQueryClassifierService;

  beforeEach(async () => {
    generateAgentTextMock.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        LlmQueryClassifierService,
        { provide: aiConfig.KEY, useValue: mockAiConfig },
      ],
    }).compile();

    service = module.get(LlmQueryClassifierService);
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it('returns parsed class/confidence/reasoning on a valid JSON response', async () => {
    generateAgentTextMock.mockResolvedValueOnce(
      '{"class":"analytical","confidence":0.92,"reasoning":"asks for comparison"}',
    );

    const result = await service.classify('compare Apple and Microsoft margins');

    expect(result.class).toBe('analytical');
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.reasoning).toBe('asks for comparison');
    expect(result.parseFallback).toBeUndefined();
  });

  it('extracts JSON even when wrapped in code fences / extra prose', async () => {
    generateAgentTextMock.mockResolvedValueOnce(
      'Sure! Here is the result:\n```json\n{"class":"factoid","confidence":0.7}\n```',
    );

    const result = await service.classify('what is Apple revenue');

    expect(result.class).toBe('factoid');
    expect(result.confidence).toBeCloseTo(0.7);
  });

  // ── prompt wiring ─────────────────────────────────────────────────────────

  it('passes the canonical system prompt and few-shot prefix to the runtime', async () => {
    generateAgentTextMock.mockResolvedValueOnce(
      '{"class":"factoid","confidence":1,"reasoning":"x"}',
    );

    await service.classify('what is Apple revenue');

    expect(generateAgentTextMock).toHaveBeenCalledTimes(1);
    const args = generateAgentTextMock.mock.calls[0][0];
    expect(args.systemPrompt).toBe(QUERY_CLASSIFIER_SYSTEM_PROMPT);
    expect(args.prompt).toContain('what is Apple revenue');
    // Few-shot exemplars are prefixed in order:
    for (const ex of QUERY_CLASSIFIER_FEW_SHOT) {
      expect(args.prompt).toContain(ex.q);
    }
    // Tools must be empty — classifier is non-agentic.
    expect(args.tools).toEqual({});
    expect(args.apiKey).toBe('test-key');
  });

  // ── parse failure modes ──────────────────────────────────────────────────

  it('falls back to factoid + parseFallback on malformed JSON', async () => {
    generateAgentTextMock.mockResolvedValueOnce('not json at all');

    const result = await service.classify('what is Apple revenue');

    expect(result.class).toBe('factoid');
    expect(result.confidence).toBe(0);
    expect(result.parseFallback).toBe(true);
    expect(result.reasoning).toMatch(/parse_failed/);
  });

  it('falls back to factoid when LLM returns an unknown class', async () => {
    generateAgentTextMock.mockResolvedValueOnce(
      '{"class":"galactic","confidence":0.99}',
    );

    const result = await service.classify('what is Apple revenue');

    expect(result.class).toBe('factoid');
    expect(result.parseFallback).toBe(true);
    expect(result.reasoning).toMatch(/bad_class:galactic/);
  });

  it('returns factoid + parseFallback on LLM exception (network etc.)', async () => {
    generateAgentTextMock.mockRejectedValueOnce(new Error('econnrefused'));

    const result = await service.classify('what is Apple revenue');

    expect(result.class).toBe('factoid');
    expect(result.confidence).toBe(0);
    expect(result.parseFallback).toBe(true);
    expect(result.reasoning).toContain('econnrefused');
  });

  it('returns empty-query fallback without calling the LLM', async () => {
    const result = await service.classify('   ');

    expect(generateAgentTextMock).not.toHaveBeenCalled();
    expect(result.class).toBe('factoid');
    expect(result.parseFallback).toBe(true);
    expect(result.reasoning).toBe('empty_query');
  });

  // ── confidence clamping ──────────────────────────────────────────────────

  it('clamps out-of-range confidence into [0, 1]', () => {
    expect(parseLlmResponse('{"class":"factoid","confidence":1.5}', 'q').confidence).toBe(1);
    expect(parseLlmResponse('{"class":"factoid","confidence":-0.2}', 'q').confidence).toBe(0);
  });

  // ── prompt builder ───────────────────────────────────────────────────────

  it('buildClassifierPrompt includes every few-shot exemplar plus the target query', () => {
    const prompt = buildClassifierPrompt('how is Microsoft connected to OpenAI');
    for (const ex of QUERY_CLASSIFIER_FEW_SHOT) {
      expect(prompt).toContain(ex.q);
    }
    expect(prompt).toContain('how is Microsoft connected to OpenAI');
    expect(prompt.endsWith('Response:')).toBe(true);
  });
});
