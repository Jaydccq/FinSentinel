import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvalidEmbeddingDimensionError,
  OpenAICompatibleEmbeddingClient,
  OpenRouterEmbeddingClient,
} from './embeddings';

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
    // 503 is retryable, so the client may call fetch up to maxRetries times.
    // Use `mockImplementation` so each call gets a fresh Response and we can
    // assert the surfaced error after retries are exhausted.
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => createJsonResponse({ error: 'upstream down' }, 503));

    const client = new OpenRouterEmbeddingClient({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      fetchImpl: fetchMock,
      // Disable backoff sleeps so the test stays fast.
      setTimeoutImpl: ((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
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

  describe('reliability semantics', () => {
    beforeEach(() => {
      // Force deterministic jitter (centered) for backoff tests.
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('retries once on 429 then succeeds on 200', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse({ error: 'rate limited' }, 429))
        .mockResolvedValueOnce(createJsonResponse({ data: [{ embedding: [1, 2, 3] }] }));

      const client = new OpenAICompatibleEmbeddingClient({
        apiKey: 'test-key',
        model: 'text-embedding-3-large',
        fetchImpl: fetchMock,
        maxRetries: 3,
        // Skip the backoff sleep entirely so the test runs without fake timers.
        setTimeoutImpl: ((fn: () => void) => {
          fn();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as unknown as typeof setTimeout,
      });

      await expect(client.embedChunks(['hello'])).resolves.toEqual([[1, 2, 3]]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 500 (non-retryable) and surfaces immediately', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse({ error: 'oops' }, 500));

      const client = new OpenAICompatibleEmbeddingClient({
        apiKey: 'test-key',
        model: 'text-embedding-3-large',
        fetchImpl: fetchMock,
        maxRetries: 3,
      });

      await expect(client.embedChunks(['hello'])).rejects.toThrow(/500/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('exhausts MAX_RETRIES on persistent 429 then propagates', async () => {
      // Each call returns a fresh Response — Response.text() is single-use.
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => createJsonResponse({ error: 'rate limited' }, 429));

      const client = new OpenAICompatibleEmbeddingClient({
        apiKey: 'test-key',
        model: 'text-embedding-3-large',
        fetchImpl: fetchMock,
        maxRetries: 3,
        setTimeoutImpl: ((fn: () => void) => {
          fn();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as unknown as typeof setTimeout,
      });

      await expect(client.embedChunks(['hello'])).rejects.toThrow(/429/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('aborts the request when the configured timeout elapses', async () => {
      vi.useFakeTimers();
      try {
        // fetchImpl that resolves only when its AbortSignal fires.
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
          const signal = init?.signal;
          return await new Promise<Response>((_resolve, reject) => {
            if (signal) {
              signal.addEventListener('abort', () => {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
              });
            }
          });
        });

        const client = new OpenAICompatibleEmbeddingClient({
          apiKey: 'test-key',
          model: 'text-embedding-3-large',
          fetchImpl: fetchMock as unknown as typeof fetch,
          timeoutMs: 1_000,
          maxRetries: 1,
        });

        const pending = client.embedChunks(['slow']);
        // Attach a swallowing handler immediately to avoid an
        // unhandled-rejection warning while we advance fake timers below.
        const captured = pending.catch((e) => e);
        await vi.advanceTimersByTimeAsync(1_000);
        const error = (await captured) as Error;
        expect(error).toBeInstanceOf(Error);
        expect(error.name === 'AbortError' || /abort/i.test(error.message)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws InvalidEmbeddingDimensionError when dimension does not match', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createJsonResponse({
          // Configured dimension below = 4, response gives 3.
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      );

      const client = new OpenAICompatibleEmbeddingClient({
        apiKey: 'test-key',
        model: 'text-embedding-3-large',
        fetchImpl: fetchMock,
        dimension: 4,
      });

      const error = await captureError(client.embedChunks(['hello']));
      expect(error).toBeInstanceOf(InvalidEmbeddingDimensionError);
      const dimErr = error as InvalidEmbeddingDimensionError;
      expect(dimErr.expected).toBe(4);
      expect(dimErr.actual).toBe(3);
      expect(dimErr.index).toBe(0);
    });

    it('caps in-flight requests at the configured concurrency', async () => {
      let inFlight = 0;
      let observedMax = 0;
      const releasers: Array<() => void> = [];

      const fetchMock = vi.fn(async () => {
        inFlight += 1;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise<void>((resolve) => releasers.push(resolve));
        inFlight -= 1;
        return createJsonResponse({ data: [{ embedding: [1] }] });
      });

      const client = new OpenAICompatibleEmbeddingClient({
        apiKey: 'test-key',
        model: 'text-embedding-3-large',
        fetchImpl: fetchMock as unknown as typeof fetch,
        concurrency: 2,
      });

      const promises = [
        client.embedQuery('a'),
        client.embedQuery('b'),
        client.embedQuery('c'),
        client.embedQuery('d'),
      ];

      // Allow the gated tasks to start (only 2 should be in-flight).
      await new Promise((r) => setImmediate(r));
      // Release them one at a time so the queue drains.
      while (releasers.length > 0) {
        releasers.shift()!();
        await new Promise((r) => setImmediate(r));
      }

      await Promise.all(promises);
      expect(observedMax).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
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
