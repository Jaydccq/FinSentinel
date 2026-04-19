import { Injectable } from '@nestjs/common';
import type { VariantKind } from './retrieval-planner.service';

export interface RankedCandidate {
  chunkId: string;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  lane: 'dense' | 'sparse' | 'graph';
  /** Which query variant produced this candidate, if applicable. */
  variantKind?: VariantKind;
  /** Which representation surface produced this candidate. */
  representationType?: string;
}

export interface FusedCandidate extends Omit<RankedCandidate, 'lane' | 'score' | 'variantKind' | 'representationType'> {
  rrfScore: number;
  lanes: string[];
  /** All representation types that contributed hits for this chunkId. */
  representationTypesSeen: string[];
  /** All variant kinds that contributed hits for this chunkId. */
  variantKindsSeen: VariantKind[];
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
          if (
            candidate.representationType &&
            !existing.representationTypesSeen.includes(candidate.representationType)
          ) {
            existing.representationTypesSeen.push(candidate.representationType);
          }
          if (
            candidate.variantKind &&
            !existing.variantKindsSeen.includes(candidate.variantKind)
          ) {
            existing.variantKindsSeen.push(candidate.variantKind);
          }
        } else {
          fusedMap.set(candidate.chunkId, {
            chunkId: candidate.chunkId,
            sourceId: candidate.sourceId,
            content: candidate.content,
            metadata: candidate.metadata,
            rrfScore: rrfContribution,
            lanes: [candidate.lane],
            representationTypesSeen: candidate.representationType
              ? [candidate.representationType]
              : [],
            variantKindsSeen: candidate.variantKind ? [candidate.variantKind] : [],
          });
        }
      }
    }

    return [...fusedMap.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  }
}
