import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QueryRewriteService } from '../query-rewrite.service';
import { aiConfig } from '../../config/ai.config';

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenAICompatibleModel: vi.fn(() => 'mock-model'),
  generateAgentText: vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => prompt.trim()),
}));

const mockAiConfig = {
  openrouterApiKey: 'test-key',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash-preview',
  embeddingModel: 'text-embedding-3-small',
};

// ── Config factory ────────────────────────────────────────────────────────
function createConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'rag.retrieval.queryRewriteEnabled': true,
    'rag.retrieval.queryRewriteMaxLength': 80,
    ...overrides,
  };
  return {
    get: (key: string, defaultVal: unknown) => defaults[key] ?? defaultVal,
  };
}

describe('QueryRewriteService', () => {
  let service: QueryRewriteService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        QueryRewriteService,
        { provide: ConfigService, useValue: createConfigService() },
        { provide: aiConfig.KEY, useValue: mockAiConfig },
      ],
    }).compile();

    service = module.get(QueryRewriteService);
  });

  // ── rewrite: enabled ────────────────────────────────────────────────────

  it('returns the query (cleaned) when enabled', async () => {
    const result = await service.rewrite('What is AAPL risk?');

    expect(result).toBe('What is AAPL risk?');
  });

  it('returns empty/whitespace query unchanged', async () => {
    const result = await service.rewrite('   ');

    expect(result).toBe('   ');
  });

  it('truncates long queries to maxLength', async () => {
    const longQuery = 'A'.repeat(200);
    const result = await service.rewrite(longQuery);

    expect(result.length).toBeLessThanOrEqual(80);
  });

  // ── rewrite: disabled ───────────────────────────────────────────────────

  it('returns original query unchanged when disabled', async () => {
    const module = await Test.createTestingModule({
      providers: [
        QueryRewriteService,
        {
          provide: ConfigService,
          useValue: createConfigService({ 'rag.retrieval.queryRewriteEnabled': false }),
        },
        { provide: aiConfig.KEY, useValue: mockAiConfig },
      ],
    }).compile();

    const disabledService = module.get(QueryRewriteService);
    const result = await disabledService.rewrite('What is AAPL risk?');

    expect(result).toBe('What is AAPL risk?');
  });

  // ── generateRewrite ─────────────────────────────────────────────────────

  it('generateRewrite returns cleaned query', async () => {
    const result = await service.generateRewrite('What is AAPL risk?');

    expect(result).toBe('What is AAPL risk?');
  });

  it('generateRewrite truncates to maxLength', async () => {
    const longQuery = 'B'.repeat(200);
    const result = await service.generateRewrite(longQuery);

    expect(result.length).toBe(80);
    expect(result).toBe('B'.repeat(80));
  });

  // ── Custom maxLength ────────────────────────────────────────────────────

  it('respects custom maxLength', async () => {
    const module = await Test.createTestingModule({
      providers: [
        QueryRewriteService,
        {
          provide: ConfigService,
          useValue: createConfigService({ 'rag.retrieval.queryRewriteMaxLength': 30 }),
        },
        { provide: aiConfig.KEY, useValue: mockAiConfig },
      ],
    }).compile();

    const shortService = module.get(QueryRewriteService);
    const longQuery = 'C'.repeat(100);
    const result = await shortService.rewrite(longQuery);

    expect(result.length).toBeLessThanOrEqual(30);
  });

  // ── isEnabled / getMaxLength ────────────────────────────────────────────

  it('isEnabled returns configured value', () => {
    expect(service.isEnabled()).toBe(true);
  });

  it('getMaxLength returns configured value', () => {
    expect(service.getMaxLength()).toBe(80);
  });
});
