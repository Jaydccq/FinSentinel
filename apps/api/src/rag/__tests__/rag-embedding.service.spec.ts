import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RagEmbeddingService } from '../rag-embedding.service';

const { embedQuery, embedChunks, openAICompatibleEmbeddingClientMock } = vi.hoisted(() => {
  const embedQuery = vi.fn();
  const embedChunks = vi.fn();

  return {
    embedQuery,
    embedChunks,
    openAICompatibleEmbeddingClientMock: vi.fn(function OpenAICompatibleEmbeddingClientMock() {
      return {
        embedQuery,
        embedChunks,
      };
    }),
  };
});

vi.mock('@finsentinel/ai-runtime', () => ({
  OpenAICompatibleEmbeddingClient: openAICompatibleEmbeddingClientMock,
}));

const mockAiConfig = {
  openrouterApiKey: 'test-key',
  openrouterBaseUrl: 'https://openrouter.example/v1',
  model: 'google/gemini-3-flash-preview',
  embeddingModel: 'text-embedding-3-small',
  // Reliability tuning — these are forwarded to the runtime client and
  // therefore appear in the toHaveBeenCalledWith assertions below.
  embeddingTimeoutMs: 30_000,
  embeddingMaxRetries: 3,
  embeddingConcurrency: 8,
  embeddingDimension: undefined,
};

describe('RagEmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes ai config into the runtime embedding client', () => {
    new RagEmbeddingService(mockAiConfig);

    expect(openAICompatibleEmbeddingClientMock).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.example/v1',
      model: 'text-embedding-3-small',
      timeoutMs: 30_000,
      maxRetries: 3,
      concurrency: 8,
      dimension: undefined,
    });
  });

  it('configures NVIDIA asymmetric embedding input types', () => {
    new RagEmbeddingService({
      ...mockAiConfig,
      embeddingProvider: 'nvidia',
      embeddingApiKey: 'nvapi-test',
      embeddingBaseUrl: 'https://integrate.api.nvidia.com/v1',
      embeddingModel: 'nvidia/llama-nemotron-embed-1b-v2',
    });

    expect(openAICompatibleEmbeddingClientMock).toHaveBeenCalledWith({
      apiKey: 'nvapi-test',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/llama-nemotron-embed-1b-v2',
      timeoutMs: 30_000,
      maxRetries: 3,
      concurrency: 8,
      dimension: undefined,
      queryInputType: 'query',
      chunkInputType: 'passage',
    });
  });

  it('delegates embedQuery to the runtime client and returns the embedding', async () => {
    embedQuery.mockResolvedValueOnce([1, 0, 0]);
    const service = new RagEmbeddingService(mockAiConfig);

    await expect(service.embedQuery('risk')).resolves.toEqual([1, 0, 0]);
    expect(embedQuery).toHaveBeenCalledWith('risk');
  });

  it('delegates embedChunks to the runtime client and returns chunk embeddings', async () => {
    embedChunks.mockResolvedValueOnce([
      [1, 1, 1],
      [2, 2, 2],
    ]);
    const service = new RagEmbeddingService(mockAiConfig);

    await expect(service.embedChunks(['first', 'second'])).resolves.toEqual([
      [1, 1, 1],
      [2, 2, 2],
    ]);
    expect(embedChunks).toHaveBeenCalledWith(['first', 'second']);
  });

  it('delegates empty chunk lists to the runtime client', async () => {
    embedChunks.mockResolvedValueOnce([]);
    const service = new RagEmbeddingService(mockAiConfig);

    await expect(service.embedChunks([])).resolves.toEqual([]);
    expect(embedChunks).toHaveBeenCalledWith([]);
  });
});
