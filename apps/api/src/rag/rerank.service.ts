import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FusedCandidate } from './retrieval-fusion.service';

export interface RerankedCandidate extends FusedCandidate {
  rerankScore: number;
}

@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  private readonly sidecarUrl: string;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService) {
    this.sidecarUrl = configService.get<string>('RERANKER_URL', 'http://localhost:8100');
    this.timeoutMs = configService.get<number>('RERANKER_TIMEOUT_MS', 5000);
  }

  async rerank(
    query: string,
    candidates: FusedCandidate[],
    topK: number,
  ): Promise<RerankedCandidate[]> {
    try {
      const response = await fetch(`${this.sidecarUrl}/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          candidates: candidates.map((c) => ({ id: c.chunkId, text: c.content })),
          top_k: topK,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Reranker returned ${response.status}`);
      }

      const data = (await response.json()) as {
        results: Array<{ id: string; score: number; rank: number }>;
      };

      const candidateMap = new Map(candidates.map((c) => [c.chunkId, c]));

      return data.results
        .filter((r) => candidateMap.has(r.id))
        .map((r) => ({
          ...candidateMap.get(r.id)!,
          rerankScore: r.score,
        }));
    } catch (error) {
      this.logger.warn(`Reranker unavailable, falling back to RRF scores: ${error}`);
      return candidates
        .sort((a, b) => b.rrfScore - a.rrfScore)
        .slice(0, topK)
        .map((c) => ({ ...c, rerankScore: c.rrfScore }));
    }
  }
}
