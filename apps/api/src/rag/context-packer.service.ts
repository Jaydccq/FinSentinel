import { Injectable } from '@nestjs/common';
import type { RerankedCandidate } from './rerank.service';

export interface PackedChunk {
  chunkId: string;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface PackedContext {
  chunks: PackedChunk[];
  totalTokenEstimate: number;
}

export interface PackingOptions {
  maxTokens?: number;
  maxChunksPerSource?: number;
}

@Injectable()
export class ContextPackerService {
  private static readonly DEFAULT_MAX_TOKENS = 4096;
  private static readonly DEFAULT_MAX_CHUNKS_PER_SOURCE = 3;

  pack(candidates: RerankedCandidate[], options: PackingOptions = {}): PackedContext {
    const maxTokens = options.maxTokens ?? ContextPackerService.DEFAULT_MAX_TOKENS;
    const maxPerSource =
      options.maxChunksPerSource ?? ContextPackerService.DEFAULT_MAX_CHUNKS_PER_SOURCE;

    // Dedup by chunkId
    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      if (seen.has(c.chunkId)) return false;
      seen.add(c.chunkId);
      return true;
    });

    // Source diversity enforcement
    const sourceCounts = new Map<string, number>();
    const diversified = deduped.filter((c) => {
      const count = sourceCounts.get(c.sourceId) ?? 0;
      if (count >= maxPerSource) return false;
      sourceCounts.set(c.sourceId, count + 1);
      return true;
    });

    // Token budget control
    let tokenBudget = maxTokens;
    const packed: PackedChunk[] = [];

    for (const c of diversified) {
      const tokenEstimate = this.estimateTokens(c.content);
      if (tokenBudget - tokenEstimate < 0 && packed.length > 0) break;
      packed.push({
        chunkId: c.chunkId,
        sourceId: c.sourceId,
        content: c.content,
        metadata: c.metadata,
      });
      tokenBudget -= tokenEstimate;
    }

    return {
      chunks: packed,
      totalTokenEstimate: maxTokens - tokenBudget,
    };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
