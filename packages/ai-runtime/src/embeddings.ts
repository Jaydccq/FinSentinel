import { DEFAULT_OPENROUTER_BASE_URL } from './model';

export interface OpenAICompatibleEmbeddingClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export type OpenRouterEmbeddingClientOptions = OpenAICompatibleEmbeddingClientOptions;

interface OpenRouterEmbeddingResponseItem {
  embedding?: unknown;
}

interface OpenRouterEmbeddingResponseBody {
  data?: unknown;
}

const RESPONSE_SNIPPET_LIMIT = 500;

export class OpenAICompatibleEmbeddingClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAICompatibleEmbeddingClientOptions) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? DEFAULT_OPENROUTER_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embedQuery(value: string): Promise<number[]> {
    const embeddings = await this.embedChunks([value]);
    return embeddings[0] ?? [];
  }

  async embedChunks(values: string[]): Promise<number[][]> {
    if (values.length === 0) {
      return [];
    }

    const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        input: values,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `Embedding request failed with status ${response.status} ${response.statusText}: ${this.formatResponseSnippet(responseBody)}`,
      );
    }

    const body = (await this.parseJsonResponse(response)) as OpenRouterEmbeddingResponseBody;
    const data = body.data;

    if (!Array.isArray(data)) {
      throw new Error('Embedding response is missing a data array');
    }

    const embeddings = data.map((item, index) => this.parseEmbeddingItem(item as OpenRouterEmbeddingResponseItem, index));

    if (embeddings.length !== values.length) {
      throw new Error(`Embedding response expected ${values.length} embeddings, got ${embeddings.length}`);
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
      throw new Error(`Embedding response item ${index} has invalid embedding: expected a numeric array`);
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
