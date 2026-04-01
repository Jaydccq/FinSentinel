import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Query rewrite service for RAG retrieval enhancement.
 *
 * Rewrites user queries to be more specific and effective for
 * searching a financial document database. Uses LLM to generate
 * a refined query while keeping it under the configured max length.
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

  constructor(configService: ConfigService) {
    this.enabled = configService.get<boolean>('rag.retrieval.queryRewriteEnabled', true);
    this.maxLength = configService.get<number>('rag.retrieval.queryRewriteMaxLength', 80);
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
   * Generate a rewritten query using LLM.
   *
   * TODO: Wire actual AI SDK generateText call here.
   * For now, applies basic heuristic rewrites for financial queries.
   */
  async generateRewrite(query: string): Promise<string> {
    // TODO: Replace with actual LLM call:
    //
    // const { text } = await generateText({
    //   model: openai(this.model),
    //   system: `Rewrite the following query to be more specific and effective
    //            for searching a financial document database. Keep it under
    //            ${this.maxLength} characters. Return only the rewritten query.`,
    //   prompt: query,
    // });
    // return text.substring(0, this.maxLength);

    // Heuristic fallback: clean up and truncate the query
    const cleaned = query.trim();
    if (cleaned.length <= this.maxLength) {
      return cleaned;
    }

    return cleaned.substring(0, this.maxLength);
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
