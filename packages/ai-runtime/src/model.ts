import type { Model } from '@mariozechner/pi-ai';

export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_OPENROUTER_TEXT_MODEL = 'google/gemini-3-flash-preview';
export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_NVIDIA_EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-1b-v2';

export const AI_PROVIDERS = ['openrouter', 'nvidia'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface OpenAICompatibleModelOptions {
  provider?: AiProvider;
  modelId: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  cost?: Model<'openai-completions'>['cost'];
}

export type OpenRouterModelOptions = Omit<OpenAICompatibleModelOptions, 'provider'>;

const FALLBACK_COST: Model<'openai-completions'>['cost'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function getProviderDefaults(provider: AiProvider) {
  if (provider === 'nvidia') {
    return {
      baseUrl: DEFAULT_NVIDIA_BASE_URL,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        maxTokensField: 'max_tokens' as const,
        supportsStrictMode: false,
      },
    };
  }

  return {
    baseUrl: DEFAULT_OPENROUTER_BASE_URL,
    compat: {
      thinkingFormat: 'openrouter' as const,
      supportsStore: false,
    },
  };
}

export function createOpenAICompatibleModel(options: OpenAICompatibleModelOptions): Model<'openai-completions'> {
  const provider = options.provider ?? 'openrouter';
  const defaults = getProviderDefaults(provider);

  return {
    id: options.modelId,
    name: options.modelId,
    api: 'openai-completions',
    provider,
    baseUrl: options.baseUrl ?? defaults.baseUrl,
    reasoning: options.reasoning ?? false,
    input: options.input ?? ['text'],
    cost: options.cost ?? FALLBACK_COST,
    contextWindow: options.contextWindow ?? 128000,
    maxTokens: options.maxTokens ?? 8192,
    compat: defaults.compat,
  };
}

export function createOpenRouterModel(options: OpenRouterModelOptions): Model<'openai-completions'> {
  return createOpenAICompatibleModel({ ...options, provider: 'openrouter' });
}

export function createNvidiaModel(options: OpenRouterModelOptions): Model<'openai-completions'> {
  return createOpenAICompatibleModel({ ...options, provider: 'nvidia' });
}
