import type { Model } from '@mariozechner/pi-ai';
import { describe, expect, it } from 'vitest';
import { createOpenRouterModel } from './model';

describe('createOpenRouterModel', () => {
  it('creates an OpenRouter OpenAI-compatible Pi model', () => {
    const model = createOpenRouterModel({
      modelId: 'google/gemini-3-flash-preview',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(model.id).toBe('google/gemini-3-flash-preview');
    expect(model.provider).toBe('openrouter');
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(model.compat).toMatchObject({
      thinkingFormat: 'openrouter',
      supportsStore: false,
    });
  });

  it('uses the default OpenRouter base URL', () => {
    const model = createOpenRouterModel({ modelId: 'openai/gpt-4o-mini' });

    expect(model.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(model.reasoning).toBe(false);
    expect(model.compat).toMatchObject({
      thinkingFormat: 'openrouter',
      supportsStore: false,
    });
  });

  it('honors explicit metadata for configured OpenRouter models', () => {
    const customCost: Model<'openai-completions'>['cost'] = {
      input: 100,
      output: 200,
      cacheRead: 300,
      cacheWrite: 400,
    };

    const model = createOpenRouterModel({
      modelId: 'google/gemini-3-flash-preview',
      contextWindow: 1,
      maxTokens: 2,
      reasoning: true,
      input: ['text'],
      cost: customCost,
    });

    expect(model.contextWindow).toBe(1);
    expect(model.maxTokens).toBe(2);
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(['text']);
    expect(model.cost).toEqual(customCost);
  });

  it('honors fallback metadata for unknown models', () => {
    const customCost: Model<'openai-completions'>['cost'] = {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
    };

    const model = createOpenRouterModel({
      modelId: 'custom/unknown-model',
      baseUrl: 'https://example.com/openrouter',
      contextWindow: 4096,
      maxTokens: 512,
      reasoning: true,
      input: ['image'],
      cost: customCost,
    });

    expect(model.baseUrl).toBe('https://example.com/openrouter');
    expect(model.contextWindow).toBe(4096);
    expect(model.maxTokens).toBe(512);
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(['image']);
    expect(model.cost).toEqual(customCost);
    expect(model.compat).toMatchObject({
      thinkingFormat: 'openrouter',
      supportsStore: false,
    });
  });
});
