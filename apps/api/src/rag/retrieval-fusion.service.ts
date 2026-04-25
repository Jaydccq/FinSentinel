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
  /** Which representation surface(s) produced this candidate. */
  representationType?: string[];
}

export interface FusedCandidate extends Omit<
  RankedCandidate,
  'lane' | 'score' | 'variantKind' | 'representationType'
> {
  rrfScore: number;
  lanes: string[];
  /** All representation types that contributed hits for this chunkId. */
  representationTypesSeen: string[];
  /** All variant kinds that contributed hits for this chunkId. */
  variantKindsSeen: VariantKind[];
}

/**
 * A lane wrapped with its variant weight. The fuser multiplies every RRF
 * contribution from this lane by `weight`; default 1.0 preserves vanilla RRF.
 */
export interface WeightedLane {
  candidates: RankedCandidate[];
  /** RRF contribution multiplier. Default 1. */
  weight?: number;
}

function isWeightedLane(input: unknown): input is WeightedLane {
  return (
    typeof input === 'object' &&
    input !== null &&
    'candidates' in input &&
    Array.isArray((input as { candidates: unknown }).candidates)
  );
}

@Injectable()
export class RetrievalFusionService {
  /**
   * Weighted Reciprocal Rank Fusion. Accepts either:
   *   - `RankedCandidate[][]` — legacy unweighted (every lane weight = 1)
   *   - `WeightedLane[]`      — per-lane `weight` consumed
   *
   * Both signatures work so existing call sites don't need updating.
   */
  fuse(lanes: RankedCandidate[][] | WeightedLane[], k = 60): FusedCandidate[] {
    const weightedLanes: WeightedLane[] = lanes.map((lane) =>
      isWeightedLane(lane) ? lane : { candidates: lane, weight: 1 },
    );

    const fusedMap = new Map<string, FusedCandidate>();

    for (const lane of weightedLanes) {
      const weight = lane.weight ?? 1;
      // weight=0 fully mutes the lane — its candidates contribute nothing
      // and don't even surface in the fused output (caller asked us to
      // explicitly suppress this variant).
      if (weight === 0) continue;
      for (let rank = 0; rank < lane.candidates.length; rank++) {
        const candidate = lane.candidates[rank]!;
        const rrfContribution = weight * (1 / (k + rank + 1));

        const existing = fusedMap.get(candidate.chunkId);
        if (existing) {
          existing.rrfScore += rrfContribution;
          if (!existing.lanes.includes(candidate.lane)) {
            existing.lanes.push(candidate.lane);
          }
          if (candidate.representationType) {
            for (const rt of candidate.representationType) {
              if (!existing.representationTypesSeen.includes(rt)) {
                existing.representationTypesSeen.push(rt);
              }
            }
          }
          if (candidate.variantKind && !existing.variantKindsSeen.includes(candidate.variantKind)) {
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
              ? [...candidate.representationType]
              : [],
            variantKindsSeen: candidate.variantKind ? [candidate.variantKind] : [],
          });
        }
      }
    }

    return [...fusedMap.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  }
}
