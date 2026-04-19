import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { createOpenRouterModel, generateAgentText } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';
import { QueryRewriteService } from './query-rewrite.service';

const HYDE_SYSTEM_PROMPT =
  "You write a short hypothetical passage that PLAUSIBLY answers the user's question as if it came from a retrieved document. " +
  'No disclaimers, no meta-commentary. Return ONLY the passage, under 400 characters.';

const DECOMPOSE_SYSTEM_PROMPT =
  "The user's question may combine multiple independent sub-questions. " +
  'Return a JSON array of 0 to 3 decomposed sub-questions, each under 100 characters. ' +
  'If the question is already atomic, return []. Return ONLY valid JSON.';

const MAX_HYDE_CHARS = 400;
const MAX_SUBQUERIES = 3;

const decomposeOutputSchema = z.array(z.string());

/**
 * QueryVariantService generates additional query representations for multi-path
 * RAG retrieval: HyDE (hypothetical document embedding) and query decomposition.
 *
 * Rewrite is delegated to QueryRewriteService to avoid duplicate prompts.
 * Both hyde() and decompose() degrade gracefully -- they return null / [] on
 * LLM failure and never throw.
 */
@Injectable()
export class QueryVariantService {
  private readonly logger = new Logger(QueryVariantService.name);
  private readonly model;

  constructor(
    private readonly queryRewrite: QueryRewriteService,
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
  ) {
    this.model = createOpenRouterModel({
      modelId: this.aiCfg.model,
      baseUrl: this.aiCfg.openrouterBaseUrl,
    });
  }

  /**
   * Delegates to QueryRewriteService. Exposed here for completeness so callers
   * need only one service.
   */
  async rewrite(query: string): Promise<string> {
    return this.queryRewrite.rewrite(query);
  }

  /**
   * Generate a hypothetical answer document for embedding (HyDE pattern).
   *
   * Returns null if the LLM fails or returns an empty string.
   */
  async hyde(query: string): Promise<string | null> {
    try {
      const raw = await generateAgentText({
        model: this.model,
        systemPrompt: HYDE_SYSTEM_PROMPT,
        prompt: query,
        tools: {},
      });

      const trimmed = raw.trim();
      if (!trimmed) {
        return null;
      }

      return trimmed.substring(0, MAX_HYDE_CHARS);
    } catch (error) {
      this.logger.warn(`HyDE generation failed for query "${query}": ${error}`);
      return null;
    }
  }

  /**
   * Decompose a multi-part question into 0-3 sub-questions.
   *
   * Returns [] if the query is atomic, LLM fails, or output cannot be parsed.
   */
  async decompose(query: string): Promise<string[]> {
    try {
      const raw = await generateAgentText({
        model: this.model,
        systemPrompt: DECOMPOSE_SYSTEM_PROMPT,
        prompt: query,
        tools: {},
      });

      const parsed = decomposeOutputSchema.safeParse(JSON.parse(raw.trim()));
      if (!parsed.success) {
        this.logger.warn(
          `Decompose output failed schema validation for query "${query}": ${parsed.error.message}`,
        );
        return [];
      }

      return parsed.data.slice(0, MAX_SUBQUERIES);
    } catch (error) {
      this.logger.warn(
        `Query decomposition failed for query "${query}": ${error}`,
      );
      return [];
    }
  }
}
