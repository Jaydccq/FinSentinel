import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { QueryVariantService } from '../query-variant.service';

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenAICompatibleModel: vi.fn(() => 'mock-model'),
  generateAgentText: vi.fn(),
}));

import { generateAgentText } from '@finsentinel/ai-runtime';

const mockGenerateAgentText = generateAgentText as Mock;

const mockAiCfg = {
  openrouterApiKey: 'test-key',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash-preview',
  embeddingModel: 'text-embedding-3-small',
};

function makeService(): QueryVariantService {
  const mockRewrite = {
    rewrite: vi.fn((q: string) => Promise.resolve(`rewritten: ${q}`)),
  };
  return new QueryVariantService(mockRewrite as any, mockAiCfg as any);
}

describe('QueryVariantService', () => {
  let service: QueryVariantService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = makeService();
  });

  // ── hyde ───────────────────────────────────────────────────────────────────

  it('hyde returns trimmed paragraph on success', async () => {
    mockGenerateAgentText.mockResolvedValueOnce('  Hypothetical passage.  ');
    const result = await service.hyde('What is AAPL revenue?');
    expect(result).toBe('Hypothetical passage.');
  });

  it('hyde returns null on LLM throw', async () => {
    mockGenerateAgentText.mockRejectedValueOnce(new Error('LLM error'));
    const result = await service.hyde('What is AAPL revenue?');
    expect(result).toBeNull();
  });

  it('hyde caps output to 400 chars', async () => {
    const longPassage = 'X'.repeat(500);
    mockGenerateAgentText.mockResolvedValueOnce(longPassage);
    const result = await service.hyde('What is AAPL revenue?');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(400);
  });

  it('hyde returns null when LLM returns empty string', async () => {
    mockGenerateAgentText.mockResolvedValueOnce('   ');
    const result = await service.hyde('What is AAPL revenue?');
    expect(result).toBeNull();
  });

  // ── decompose ─────────────────────────────────────────────────────────────

  it('decompose parses valid JSON array', async () => {
    mockGenerateAgentText.mockResolvedValueOnce('["What is revenue?", "What is margin?"]');
    const result = await service.decompose('What is revenue and what is margin?');
    expect(result).toEqual(['What is revenue?', 'What is margin?']);
  });

  it('decompose returns [] on non-JSON output', async () => {
    mockGenerateAgentText.mockResolvedValueOnce('not json at all');
    const result = await service.decompose('What is revenue and margin?');
    expect(result).toEqual([]);
  });

  it('decompose caps at 3 subqueries even when LLM returns 5', async () => {
    mockGenerateAgentText.mockResolvedValueOnce('["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"]');
    const result = await service.decompose('Complex multi-part query?');
    expect(result).toHaveLength(3);
    expect(result).toEqual(['Q1?', 'Q2?', 'Q3?']);
  });

  it('decompose returns [] on LLM throw', async () => {
    mockGenerateAgentText.mockRejectedValueOnce(new Error('LLM error'));
    const result = await service.decompose('What is revenue and margin?');
    expect(result).toEqual([]);
  });

  it('decompose returns [] for empty JSON array', async () => {
    mockGenerateAgentText.mockResolvedValueOnce('[]');
    const result = await service.decompose('Simple query?');
    expect(result).toEqual([]);
  });
});
