import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { MetricsService } from '../common/services/metrics.service';
import type { FusedCandidate } from './retrieval-fusion.service';

export type FallbackReason = 'rerank_malformed' | 'rerank_unavailable' | null;

export interface RerankedCandidate extends FusedCandidate {
  rerankScore: number;
  fallbackReason: FallbackReason;
}

const RerankResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      score: z.number(),
      rank: z.number().int().nonnegative(),
    }),
  ),
});

@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  private readonly sidecarUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(
    configService: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.sidecarUrl = configService.get<string>('RERANKER_URL', 'http://localhost:8100');
    this.timeoutMs = configService.get<number>('RERANKER_TIMEOUT_MS', 5000);
    this.maxTokens = configService.get<number>('RAG_RERANK_MAX_TOKENS', 480);
  }

  async rerank(
    query: string,
    candidates: FusedCandidate[],
    topK: number,
  ): Promise<RerankedCandidate[]> {
    const payload = candidates.map((c) => ({
      id: c.chunkId,
      text: this.buildCandidateText(c),
    }));

    let response: Response;
    try {
      response = await fetch(`${this.sidecarUrl}/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, candidates: payload, top_k: topK }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Reranker returned ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Reranker unavailable, falling back to RRF scores: ${error}`);
      this.metrics?.incrementCounter(
        'rag_rerank_fallback_total',
        'Total rerank fallbacks by reason',
        { reason: 'rerank_unavailable' },
      );
      return this.rrfFallback(candidates, topK, 'rerank_unavailable');
    }

    let rawBody: unknown;
    try {
      rawBody = await response.json();
    } catch {
      this.logger.warn('Reranker 200 OK but body is not valid JSON');
      this.metrics?.incrementCounter(
        'rag_rerank_malformed_total',
        'Total rerank responses with malformed body',
        {},
      );
      this.metrics?.incrementCounter(
        'rag_rerank_fallback_total',
        'Total rerank fallbacks by reason',
        { reason: 'rerank_malformed' },
      );
      return this.rrfFallback(candidates, topK, 'rerank_malformed');
    }

    const parsed = RerankResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      const preview = JSON.stringify(rawBody).slice(0, 200);
      this.logger.warn(`Reranker malformed response (200 OK): ${preview}`);
      this.metrics?.incrementCounter(
        'rag_rerank_malformed_total',
        'Total rerank responses with malformed body',
        {},
      );
      this.metrics?.incrementCounter(
        'rag_rerank_fallback_total',
        'Total rerank fallbacks by reason',
        { reason: 'rerank_malformed' },
      );
      return this.rrfFallback(candidates, topK, 'rerank_malformed');
    }

    const candidateMap = new Map(candidates.map((c) => [c.chunkId, c]));
    return parsed.data.results
      .filter((r) => candidateMap.has(r.id))
      .map((r) => ({
        ...candidateMap.get(r.id)!,
        rerankScore: r.score,
        fallbackReason: null as FallbackReason,
      }));
  }

  private buildCandidateText(c: FusedCandidate): string {
    const metaTitle =
      typeof c.metadata['meta_title'] === 'string' ? c.metadata['meta_title'] : null;
    const sectionPath =
      typeof c.metadata['section_path'] === 'string' ? c.metadata['section_path'] : null;

    const preambleParts: string[] = [];
    if (metaTitle) preambleParts.push(`[Title: ${metaTitle}]`);
    if (sectionPath) preambleParts.push(`[Section: ${sectionPath}]`);
    const preamble = preambleParts.length > 0 ? preambleParts.join(' ') + '\n' : '';

    const budget = this.maxTokens;

    if (preamble) {
      const combined = preamble + c.content;
      const combinedTokens = this.estimateTokens(combined);
      if (combinedTokens <= budget) {
        return combined;
      }
      // Preamble + chunk exceeds budget: drop preamble first
      this.metrics?.incrementCounter(
        'rag_rerank_preamble_dropped_total',
        'Total rerank candidates where preamble was dropped due to token budget',
        {},
      );
    }

    // Send chunk only, truncating from end if necessary
    const chunkTokens = this.estimateTokens(c.content);
    if (chunkTokens <= budget) {
      return c.content;
    }
    const maxChars = budget * 4;
    const suffix = '...';
    return c.content.slice(0, maxChars - suffix.length) + suffix;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private rrfFallback(
    candidates: FusedCandidate[],
    topK: number,
    reason: FallbackReason,
  ): RerankedCandidate[] {
    return candidates
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK)
      .map((c) => ({ ...c, rerankScore: c.rrfScore, fallbackReason: reason }));
  }
}
