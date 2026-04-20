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
