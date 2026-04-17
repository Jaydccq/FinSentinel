import { getModel, type Model } from '@mariozechner/pi-ai';

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
  const registered = getModel('openrouter', options.modelId as never) as Model<'openai-completions'> | undefined;
  const isRegistered = registered !== undefined;

  return {
    id: registered?.id ?? options.modelId,
    name: registered?.name ?? options.modelId,
    api: 'openai-completions',
    provider: 'openrouter',
    baseUrl: options.baseUrl ?? registered?.baseUrl ?? DEFAULT_BASE_URL,
    reasoning: registered?.reasoning ?? options.reasoning ?? false,
    input: isRegistered ? registered.input : options.input ?? ['text'],
    cost: isRegistered ? registered.cost : options.cost ?? FALLBACK_COST,
    contextWindow: registered?.contextWindow ?? options.contextWindow ?? 128000,
    maxTokens: registered?.maxTokens ?? options.maxTokens ?? 8192,
    compat: {
      ...registered?.compat,
      thinkingFormat: 'openrouter',
      supportsStore: false,
    },
  };
}
