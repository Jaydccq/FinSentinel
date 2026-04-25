import { DEFAULT_OPENROUTER_BASE_URL } from './model';

export type EmbeddingInputType = 'query' | 'passage';

export interface OpenAICompatibleEmbeddingClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  queryInputType?: EmbeddingInputType;
  chunkInputType?: EmbeddingInputType;
  fetchImpl?: typeof fetch;
  /**
   * Per-request timeout in milliseconds. When the upstream embedding endpoint
   * does not respond before this elapses, the request is aborted via
   * `AbortController`. Defaults to 30_000 ms when omitted.
   */
  timeoutMs?: number;
  /**
   * Total number of attempts (including the first) for retryable failures.
   * Only HTTP 429 / 502 / 503 / 504 are retried — all other 4xx failures
   * surface immediately. Defaults to 3.
   */
  maxRetries?: number;
  /**
   * Maximum number of in-flight `/embeddings` calls per client instance.
   * Hand-rolled FIFO semaphore (no extra dependency). Defaults to 8.
   */
  concurrency?: number;
  /**
   * Expected embedding dimension. When set, every embedding row in the
   * response is checked against this value and a typed
   * `InvalidEmbeddingDimensionError` is thrown on mismatch. When omitted
   * (the default), dimension validation is skipped — preserving the
   * previous best-effort behaviour for callers that have not opted in.
   */
  dimension?: number;
  /**
   * Override for `setTimeout` / `clearTimeout`, used by tests with fake
   * timers. Defaults to the global functions.
   */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export type OpenRouterEmbeddingClientOptions = OpenAICompatibleEmbeddingClientOptions;

interface OpenRouterEmbeddingResponseItem {
  embedding?: unknown;
}

interface OpenRouterEmbeddingResponseBody {
  data?: unknown;
}

const RESPONSE_SNIPPET_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 8;
/**
 * Base delay (ms) before the Nth retry (0-indexed). Capped at the last
 * entry once attempts exceed the array length. Jitter is layered on top
 * by `computeBackoffDelay`.
 */
const RETRY_BASE_DELAYS_MS = [500, 1000, 2000];
const RETRY_JITTER_RATIO = 0.2;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Thrown when an upstream embedding row's vector length does not match the
 * `dimension` configured on the client. Surfaces as a named class so callers
 * can branch on it without parsing error messages.
 *
 * TODO(triage-PRD-item-7): the ingest pipeline currently surfaces this as a
 * fatal error. Persistent dimension mismatches should be diverted to a
 * dead-letter queue rather than failing the entire batch — out of scope for
 * this change. See `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md`.
 */
export class InvalidEmbeddingDimensionError extends Error {
  public readonly expected: number;
  public readonly actual: number;
  public readonly index: number;

  constructor(expected: number, actual: number, index: number) {
    super(
      `Embedding response item ${index} has invalid dimension: expected ${expected}, got ${actual}`,
    );
    this.name = 'InvalidEmbeddingDimensionError';
    this.expected = expected;
    this.actual = actual;
    this.index = index;
  }
}

/**
 * Hand-rolled FIFO semaphore. We avoid `p-limit` because it is not in the
 * workspace dependency tree and its only feature we need (a counted gate)
 * is ~15 lines.
 */
function createSemaphore(maxConcurrent: number): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  let active = 0;
  const waiters: Array<() => void> = [];

  const release = () => {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  };

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1;
        resolve();
      });
    });
  };

  return async function gated<T>(task: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function computeBackoffDelay(attemptIndex: number, rng: () => number): number {
  const idx = Math.min(attemptIndex, RETRY_BASE_DELAYS_MS.length - 1);
  const base = RETRY_BASE_DELAYS_MS[idx]!;
  // Symmetric ±20% jitter.
  const jitter = base * RETRY_JITTER_RATIO * (rng() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

interface EmbeddingHttpError {
  status: number;
  responseBody: string;
  message: string;
}

function isEmbeddingHttpError(value: unknown): value is EmbeddingHttpError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['status'] === 'number'
  );
}

export class OpenAICompatibleEmbeddingClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

  private readonly timeoutMs: number;

  private readonly maxRetries: number;

  private readonly dimension: number | undefined;

  private readonly setTimeoutImpl: typeof setTimeout;

  private readonly clearTimeoutImpl: typeof clearTimeout;

  private readonly gated: <T>(task: () => Promise<T>) => Promise<T>;

  /**
   * Random source for jitter. Overridable in tests by replacing
   * `Math.random` via `vi.spyOn`. Kept as a property to avoid bringing in a
   * full DI seam for a 1-line concern.
   */
  protected rng: () => number = Math.random;

  constructor(private readonly options: OpenAICompatibleEmbeddingClientOptions) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? DEFAULT_OPENROUTER_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.dimension = options.dimension;
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
    this.gated = createSemaphore(options.concurrency ?? DEFAULT_CONCURRENCY);
  }

  async embedQuery(value: string): Promise<number[]> {
    const embeddings = await this.embedValues([value], this.options.queryInputType);
    return embeddings[0] ?? [];
  }

  async embedChunks(values: string[]): Promise<number[][]> {
    return this.embedValues(values, this.options.chunkInputType);
  }

  private async embedValues(
    values: string[],
    inputType: EmbeddingInputType | undefined,
  ): Promise<number[][]> {
    if (values.length === 0) {
      return [];
    }

    const requestBody = {
      model: this.options.model,
      input: values,
      ...(inputType ? { input_type: inputType } : {}),
    };

    return this.gated(() => this.executeWithRetry(requestBody, values.length));
  }

  private async executeWithRetry(
    requestBody: unknown,
    expectedCount: number,
  ): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        return await this.executeOnce(requestBody, expectedCount);
      } catch (err) {
        lastError = err;
        const retryable = isEmbeddingHttpError(err) && RETRYABLE_STATUSES.has(err.status);
        const isLastAttempt = attempt === this.maxRetries - 1;
        if (!retryable || isLastAttempt) {
          throw this.normalizeError(err);
        }
        const delay = computeBackoffDelay(attempt, this.rng);
        await this.sleep(delay);
      }
    }
    // Defensive — loop always either returns or throws.
    throw this.normalizeError(lastError);
  }

  private normalizeError(err: unknown): Error {
    if (isEmbeddingHttpError(err)) {
      return new Error(err.message);
    }
    if (err instanceof Error) return err;
    return new Error(String(err));
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.setTimeoutImpl(resolve, ms);
    });
  }

  private async executeOnce(requestBody: unknown, expectedCount: number): Promise<number[][]> {
    const controller = new AbortController();
    const timeoutHandle = this.setTimeoutImpl(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      this.clearTimeoutImpl(timeoutHandle);
    }

    if (!response.ok) {
      const responseBody = await response.text();
      const message = `Embedding request failed with status ${response.status} ${response.statusText}: ${this.formatResponseSnippet(responseBody)}`;
      const httpError: EmbeddingHttpError = {
        status: response.status,
        responseBody,
        message,
      };
      throw httpError;
    }

    const body = (await this.parseJsonResponse(response)) as OpenRouterEmbeddingResponseBody;
    const data = body.data;

    if (!Array.isArray(data)) {
      throw new Error('Embedding response is missing a data array');
    }

    const embeddings = data.map((item, index) =>
      this.parseEmbeddingItem(item as OpenRouterEmbeddingResponseItem, index),
    );

    if (embeddings.length !== expectedCount) {
      throw new Error(
        `Embedding response expected ${expectedCount} embeddings, got ${embeddings.length}`,
      );
    }

    if (this.dimension !== undefined) {
      embeddings.forEach((embedding, index) => {
        if (embedding.length !== this.dimension) {
          throw new InvalidEmbeddingDimensionError(this.dimension!, embedding.length, index);
        }
      });
    }

    return embeddings;
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Embedding response was not valid JSON: ${this.formatResponseSnippet(text)}`);
    }
  }

  private formatResponseSnippet(body: string): string {
    if (body.length <= RESPONSE_SNIPPET_LIMIT) {
      return body;
    }

    return `${body.slice(0, RESPONSE_SNIPPET_LIMIT)}... [truncated]`;
  }

  private parseEmbeddingItem(item: OpenRouterEmbeddingResponseItem, index: number): number[] {
    if (!item || !Array.isArray(item.embedding)) {
      throw new Error(
        `Embedding response item ${index} has invalid embedding: expected a numeric array`,
      );
    }

    const embedding = item.embedding.map((value, dimension) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `Embedding response item ${index} has invalid embedding: expected a numeric array, got ${String(value)} at dimension ${dimension}`,
        );
      }

      return value;
    });

    return embedding;
  }
}

export class OpenRouterEmbeddingClient extends OpenAICompatibleEmbeddingClient {}
