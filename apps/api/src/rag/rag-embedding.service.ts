import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { aiConfig } from '../config/ai.config';

@Injectable()
export class RagEmbeddingService {
  private readonly embeddingModel;

  constructor(
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
  ) {
    const openrouter = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: this.aiCfg.openrouterApiKey,
    });

    this.embeddingModel = openrouter.embedding(this.aiCfg.embeddingModel);
  }

  async embedQuery(value: string): Promise<number[]> {
    const result = await embed({
      model: this.embeddingModel,
      value,
    });

    return result.embedding;
  }

  async embedChunks(values: string[]): Promise<number[][]> {
    if (values.length === 0) {
      return [];
    }

    const result = await embedMany({
      model: this.embeddingModel,
      values,
    });

    return result.embeddings;
  }
}
