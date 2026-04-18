import type { Model } from '@mariozechner/pi-ai';

export interface OpenRouterModelOptions {
  modelId: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  cost?: Model<'openai-completions'>['cost'];
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const FALLBACK_COST: Model<'openai-completions'>['cost'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function createOpenRouterModel(options: OpenRouterModelOptions): Model<'openai-completions'> {
  return {
    id: options.modelId,
    name: options.modelId,
    api: 'openai-completions',
    provider: 'openrouter',
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    reasoning: options.reasoning ?? false,
    input: options.input ?? ['text'],
    cost: options.cost ?? FALLBACK_COST,
    contextWindow: options.contextWindow ?? 128000,
    maxTokens: options.maxTokens ?? 8192,
    compat: {
      thinkingFormat: 'openrouter',
      supportsStore: false,
    },
  };
}
