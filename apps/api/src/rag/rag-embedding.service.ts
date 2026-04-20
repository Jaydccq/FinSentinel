import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { OpenAICompatibleEmbeddingClient } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';

@Injectable()
export class RagEmbeddingService {
  private readonly embeddingClient: OpenAICompatibleEmbeddingClient;

  constructor(
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
  ) {
    this.embeddingClient = new OpenAICompatibleEmbeddingClient({
      apiKey: this.aiCfg.embeddingApiKey ?? this.aiCfg.openrouterApiKey,
      baseUrl: this.aiCfg.embeddingBaseUrl ?? this.aiCfg.openrouterBaseUrl,
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
