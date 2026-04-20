import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { createOpenAICompatibleModel, generateAgentText } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';

/**
 * Query rewrite service for RAG retrieval enhancement.
 *
 * Rewrites user queries via the configured LLM to be more specific and
 * effective for searching a financial document database.
 *
 * Config (from rag.config.ts):
 * - RAG_QUERY_REWRITE_ENABLED (default true)
 * - RAG_QUERY_REWRITE_MAX_LENGTH (default 80)
 */
@Injectable()
export class QueryRewriteService {
  private readonly logger = new Logger(QueryRewriteService.name);
  private readonly enabled: boolean;
  private readonly maxLength: number;
  private readonly model;

  constructor(
    configService: ConfigService,
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
  ) {
    this.enabled = configService.get<boolean>('rag.retrieval.queryRewriteEnabled', true);
    this.maxLength = configService.get<number>('rag.retrieval.queryRewriteMaxLength', 80);

    this.model = createOpenAICompatibleModel({
      provider: this.aiCfg.provider ?? 'openrouter',
      modelId: this.aiCfg.model,
      baseUrl: this.aiCfg.baseUrl ?? this.aiCfg.openrouterBaseUrl,
    });
  }

  /**
   * Rewrite a query for better RAG retrieval.
   *
   * If query rewriting is disabled, returns the original query unchanged.
   * Otherwise, uses LLM to generate a more specific, retrieval-optimized query.
   *
   * @param query - The original user query
   * @returns The rewritten query (or original if disabled)
   */
  async rewrite(query: string): Promise<string> {
    if (!this.enabled) {
      return query;
    }

    if (!query.trim()) {
      return query;
    }

    try {
      const rewritten = await this.generateRewrite(query);
      this.logger.debug(`Query rewritten: "${query}" → "${rewritten}"`);
      return rewritten;
    } catch (error) {
      // Fall back to original query on LLM failure
      this.logger.warn(`Query rewrite failed, using original: ${error}`);
      return query;
    }
  }

  /**
   * Generate a rewritten query using LLM (OpenRouter).
   *
   * Falls back to truncation if the LLM call fails.
   */
  async generateRewrite(query: string): Promise<string> {
    try {
      const text = await generateAgentText({
        model: this.model,
        apiKey: this.aiCfg.apiKey ?? this.aiCfg.openrouterApiKey,
        systemPrompt:
          `You are a financial search query optimizer. Rewrite the following ` +
          `query to be more specific and effective for searching a financial ` +
          `document database (SEC filings, research reports, market news). ` +
          `Keep it under ${this.maxLength} characters. Return only the rewritten query.`,
        prompt: query,
        tools: {},
      });

      return text.substring(0, this.maxLength);
    } catch (error) {
      this.logger.warn(`LLM rewrite failed, using heuristic: ${error}`);
      // Heuristic fallback: clean up and truncate
      return query.trim().substring(0, this.maxLength);
    }
  }

  /** Returns whether query rewriting is enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Returns the max query length. */
  getMaxLength(): number {
    return this.maxLength;
  }
}
