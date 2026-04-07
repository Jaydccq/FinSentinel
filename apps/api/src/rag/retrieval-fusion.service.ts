import { Injectable } from '@nestjs/common';

export interface RankedCandidate {
  chunkId: string;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  lane: 'dense' | 'sparse' | 'graph';
}

export interface FusedCandidate extends Omit<RankedCandidate, 'lane' | 'score'> {
  rrfScore: number;
  lanes: string[];
}

@Injectable()
export class RetrievalFusionService {
  fuse(lanes: RankedCandidate[][], k = 60): FusedCandidate[] {
    const fusedMap = new Map<string, FusedCandidate>();

    for (const lane of lanes) {
      for (let rank = 0; rank < lane.length; rank++) {
        const candidate = lane[rank]!;
        const rrfContribution = 1 / (k + rank + 1);

        const existing = fusedMap.get(candidate.chunkId);
        if (existing) {
          existing.rrfScore += rrfContribution;
          if (!existing.lanes.includes(candidate.lane)) {
            existing.lanes.push(candidate.lane);
          }
        } else {
          fusedMap.set(candidate.chunkId, {
            chunkId: candidate.chunkId,
            sourceId: candidate.sourceId,
            content: candidate.content,
            metadata: candidate.metadata,
            rrfScore: rrfContribution,
            lanes: [candidate.lane],
          });
        }
      }
    }

    return [...fusedMap.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  }
}
