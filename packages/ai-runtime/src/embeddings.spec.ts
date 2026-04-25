import { describe, expect, it, vi } from 'vitest';
import { OpenRouterEmbeddingClient } from './embeddings';

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createTextResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (thrown) {
    if (thrown instanceof Error) {
      return thrown;
    }

    throw new Error('Expected an Error instance');
  }
}

describe('OpenRouterEmbeddingClient', () => {
  it('embedQuery returns a single embedding from a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    );

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      baseUrl: 'https://example.com/openrouter',
      fetchImpl: fetchMock,
    });

    await expect(client.embedQuery('hello world')).resolves.toEqual([0.1, 0.2, 0.3]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/openrouter/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'text-embedding-3-large',
          input: ['hello world'],
        }),
      }),
    );
  });

  it('embedChunks returns embeddings in input order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [{ embedding: [1, 1] }, { embedding: [2, 2] }, { embedding: [3, 3] }],
      }),
    );

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
    });

    await expect(client.embedChunks(['first', 'second', 'third'])).resolves.toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('passes query and passage input types when configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ data: [{ embedding: [0.1, 0.2] }] }))
      .mockResolvedValueOnce(createJsonResponse({ data: [{ embedding: [0.3, 0.4] }] }));

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'nvidia/llama-nemotron-embed-1b-v2',
      queryInputType: 'query',
      chunkInputType: 'passage',
      fetchImpl: fetchMock,
    });

    await client.embedQuery('what is risk?');
    await client.embedChunks(['risk disclosure']);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'nvidia/llama-nemotron-embed-1b-v2',
      input: ['what is risk?'],
      input_type: 'query',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      model: 'nvidia/llama-nemotron-embed-1b-v2',
      input: ['risk disclosure'],
      input_type: 'passage',
    });
  });

  it('embedChunks([]) returns [] and does not call fetch', async () => {
    const fetchMock = vi.fn();
    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
    });

    await expect(client.embedChunks([])).resolves.toEqual([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the embedding count does not match the input count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [{ embedding: [1, 2, 3] }],
      }),
    );

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
    });

    await expect(client.embedChunks(['a', 'b'])).rejects.toThrow(/expected 2 embeddings, got 1/i);
  });

  it('throws with status and response body for non-2xx responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse({ error: 'upstream down' }, 503));

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
    });

    await expect(client.embedChunks(['a'])).rejects.toThrow(/503.*upstream down/i);
  });

  it('truncates long non-2xx response bodies in the error message', async () => {
    const tailMarker = 'TAIL_SHOULD_NOT_APPEAR';
    const longBody = `${'a'.repeat(500)}${tailMarker}`;
    const fetchMock = vi.fn().mockResolvedValue(createTextResponse(longBody, 500));

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
    });

    const error = await captureError(client.embedChunks(['a']));

    expect(error.message).toContain('500');
    expect(error.message).toContain(longBody.slice(0, 500));
    expect(error.message).toContain('... [truncated]');
    expect(error.message).not.toContain(tailMarker);
  });

  it('throws a clear error for malformed embedding responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [{ embedding: ['bad', 2, null] }],
      }),
    );

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
    });

    await expect(client.embedChunks(['a'])).rejects.toThrow(/invalid embedding/i);
  });

  it('truncates invalid JSON response bodies in the error message', async () => {
    const tailMarker = 'TAIL_SHOULD_NOT_APPEAR';
    const longBody = `${'x'.repeat(500)}${tailMarker}`;
    const fetchMock = vi.fn().mockResolvedValue(createTextResponse(longBody, 200));

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
    });

    const error = await captureError(client.embedChunks(['a']));

    expect(error.message).toContain('not valid JSON');
    expect(error.message).toContain(longBody.slice(0, 500));
    expect(error.message).toContain('... [truncated]');
    expect(error.message).not.toContain(tailMarker);
  });
});
