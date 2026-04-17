import { getModel, type Model } from '@mariozechner/pi-ai';
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

  it('uses registry metadata for known OpenRouter models', () => {
    const registered = getModel('openrouter', 'google/gemini-3-flash-preview' as never) as Model<'openai-completions'> | undefined;

    expect(registered).toBeDefined();

    const model = createOpenRouterModel({ modelId: 'google/gemini-3-flash-preview' });

    expect(model.contextWindow).toBe(registered!.contextWindow);
    expect(model.maxTokens).toBe(registered!.maxTokens);
    expect(model.reasoning).toBe(registered!.reasoning);
    expect(model.input).toEqual(registered!.input);
    expect(model.cost).toEqual(registered!.cost);
    expect(model.compat).toMatchObject({
      ...registered!.compat,
      thinkingFormat: 'openrouter',
      supportsStore: false,
    });
  });

  it('ignores fallback metadata overrides for known OpenRouter models', () => {
    const registered = getModel('openrouter', 'google/gemini-3-flash-preview' as never) as Model<'openai-completions'> | undefined;
    const customCost: Model<'openai-completions'>['cost'] = {
      input: 100,
      output: 200,
      cacheRead: 300,
      cacheWrite: 400,
    };

    expect(registered).toBeDefined();

    const model = createOpenRouterModel({
      modelId: 'google/gemini-3-flash-preview',
      contextWindow: 1,
      maxTokens: 2,
      reasoning: !registered!.reasoning,
      input: ['text'],
      cost: customCost,
    });

    expect(model.contextWindow).toBe(registered!.contextWindow);
    expect(model.maxTokens).toBe(registered!.maxTokens);
    expect(model.reasoning).toBe(registered!.reasoning);
    expect(model.input).toEqual(registered!.input);
    expect(model.cost).toEqual(registered!.cost);
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
