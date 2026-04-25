import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { OpenAICompatibleEmbeddingClient } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';

@Injectable()
export class RagEmbeddingService {
  private readonly embeddingClient: OpenAICompatibleEmbeddingClient;

  constructor(@Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>) {
    const nvidiaInputTypes =
      this.aiCfg.embeddingProvider === 'nvidia'
        ? { queryInputType: 'query' as const, chunkInputType: 'passage' as const }
        : {};

    // Reliability tuning (timeout / retries / concurrency / dim) is read
    // from `aiConfig` so it can be tuned per-environment without touching
    // call sites. `embeddingDimension` is optional — when unset the client
    // falls back to its existing best-effort behaviour.
    this.embeddingClient = new OpenAICompatibleEmbeddingClient({
      apiKey: this.aiCfg.embeddingApiKey ?? this.aiCfg.openrouterApiKey,
      baseUrl: this.aiCfg.embeddingBaseUrl ?? this.aiCfg.openrouterBaseUrl,
      model: this.aiCfg.embeddingModel,
      timeoutMs: this.aiCfg.embeddingTimeoutMs,
      maxRetries: this.aiCfg.embeddingMaxRetries,
      concurrency: this.aiCfg.embeddingConcurrency,
      dimension: this.aiCfg.embeddingDimension,
      ...nvidiaInputTypes,
    });
  }

  async embedQuery(value: string): Promise<number[]> {
    return this.embeddingClient.embedQuery(value);
  }

  async embedChunks(values: string[]): Promise<number[][]> {
    return this.embeddingClient.embedChunks(values);
  }
}
