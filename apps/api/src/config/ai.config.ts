import { registerAs } from '@nestjs/config';
import {
  DEFAULT_NVIDIA_BASE_URL,
  DEFAULT_NVIDIA_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_TEXT_MODEL,
  type AiProvider,
} from '@finsentinel/ai-runtime';

function readProvider(value: string | undefined): AiProvider {
  return value === 'nvidia' ? 'nvidia' : 'openrouter';
}

function readBaseUrl(
  provider: AiProvider,
  openrouterBaseUrl: string | undefined,
  nvidiaBaseUrl: string | undefined,
): string {
  if (provider === 'nvidia') {
    return nvidiaBaseUrl || DEFAULT_NVIDIA_BASE_URL;
  }

  return openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL;
}

function readApiKey(
  provider: AiProvider,
  openrouterApiKey: string | undefined,
  nvidiaApiKey: string | undefined,
): string {
  if (provider === 'nvidia') {
    return nvidiaApiKey || '';
  }

  return openrouterApiKey || '';
}

function readDefaultEmbeddingModel(provider: AiProvider): string {
  return provider === 'nvidia'
    ? DEFAULT_NVIDIA_EMBEDDING_MODEL
    : DEFAULT_OPENROUTER_EMBEDDING_MODEL;
}

export const aiConfig = registerAs('ai', () => {
  const provider = readProvider(process.env['AI_PROVIDER']);
  const embeddingProvider = readProvider(process.env['AI_EMBEDDING_PROVIDER'] || provider);

  const openrouterApiKey = process.env['OPENROUTER_API_KEY'];
  const nvidiaApiKey = process.env['NVIDIA_API_KEY'];
  const openrouterBaseUrl = process.env['OPENROUTER_BASE_URL'];
  const nvidiaBaseUrl = process.env['NVIDIA_BASE_URL'];

  return {
    provider,
    apiKey: readApiKey(provider, openrouterApiKey, nvidiaApiKey),
    baseUrl: readBaseUrl(provider, openrouterBaseUrl, nvidiaBaseUrl),
    model: process.env['AI_MODEL'] || DEFAULT_OPENROUTER_TEXT_MODEL,

    embeddingProvider,
    embeddingApiKey: readApiKey(embeddingProvider, openrouterApiKey, nvidiaApiKey),
    embeddingBaseUrl: readBaseUrl(embeddingProvider, openrouterBaseUrl, nvidiaBaseUrl),
    embeddingModel:
      process.env['AI_EMBEDDING_MODEL'] || readDefaultEmbeddingModel(embeddingProvider),

    // Backwards-compatible names for existing tests and call sites.
    openrouterApiKey: openrouterApiKey || '',
    openrouterBaseUrl: openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL,
  };
});
