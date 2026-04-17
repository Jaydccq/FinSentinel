import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { OpenRouterEmbeddingClient } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';

@Injectable()
export class RagEmbeddingService {
  private readonly embeddingClient: OpenRouterEmbeddingClient;

  constructor(
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
  ) {
    this.embeddingClient = new OpenRouterEmbeddingClient({
      apiKey: this.aiCfg.openrouterApiKey,
      baseUrl: this.aiCfg.openrouterBaseUrl,
      model: this.aiCfg.embeddingModel,
    });
  }

  async embedQuery(value: string): Promise<number[]> {
    return this.embeddingClient.embedQuery(value);
  }

  async embedChunks(values: string[]): Promise<number[][]> {
    return this.embeddingClient.embedChunks(values);
  }
}
