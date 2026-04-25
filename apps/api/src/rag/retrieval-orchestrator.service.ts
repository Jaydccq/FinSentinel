import { Injectable, Logger, Optional } from '@nestjs/common';
import { RagChunkStoreService } from './rag-chunk-store.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { SparseSearchService, type SparseSearchFilters } from './sparse-search.service';
import {
  RetrievalFusionService,
  type RankedCandidate,
  type FusedCandidate,
} from './retrieval-fusion.service';
import { GraphRetrievalService } from './graph-retrieval.service';
import { MetadataPreFilterService } from './metadata-pre-filter.service';
import { QueryEntityExtractorService } from './query-entity-extractor.service';
import type { MetricsService } from '../common/services/metrics.service';
import type { QueryClass, QueryVariant, VariantKind } from './retrieval-planner.service';

/** Maximum number of query variants processed in parallel per orchestrate call. */
const MAX_VARIANTS = 4;

export interface OrchestrationRequest {
  rewrittenQuery: string;
  lanes: Array<'dense' | 'sparse' | 'graph'>;
  topKPerLane: number;
  filters: SparseSearchFilters;
  entityNames?: string[];
  rrfK?: number;
  /** Query variants from T4's planner. When present, orchestrator runs each (up to MAX_VARIANTS) in parallel. */
  variants?: QueryVariant[];
  /** Query class from T4's planner, forwarded to MetadataPreFilterService. */
  queryClass?: QueryClass;
  /**
   * F-5: opt into HARD SQL pushdown of top-confidence sector + region
   * extracted from the query. Default false → SOFT boost only (existing
   * post-P1-3 behavior). Enable via `/api/rag/search { strictMetadata: true }`
   * or upstream callers that want precision over recall.
   */
  strictMetadata?: boolean;
}

/**
 * Result returned by orchestrate().
 *
 * laneCounts maps each requested lane name to the total number of candidates
 * collected across all variant fan-outs. A lane that was requested but whose
 * Promise.allSettled bucket rejected is included with value 0, so consumers
 * can distinguish "ran and returned empty" from "never ran" — lanes that were
 * never requested are omitted entirely.
 *
 * Example: 4 variants × 20 dense candidates each → laneCounts.dense = 80.
 */
export interface OrchestrationResult {
  fused: FusedCandidate[];
  laneCounts: Record<string, number>;
}

@Injectable()
export class RetrievalOrchestratorService {
  private readonly logger = new Logger(RetrievalOrchestratorService.name);

  constructor(
    private readonly chunkStore: RagChunkStoreService,
    private readonly sparseSearch: SparseSearchService,
    private readonly embeddingService: RagEmbeddingService,
    private readonly fusion: RetrievalFusionService,
    private readonly metadataPreFilter: MetadataPreFilterService,
    private readonly queryEntityExtractor: QueryEntityExtractorService,
    @Optional() private readonly graphRetrieval?: GraphRetrievalService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const { rewrittenQuery, lanes, topKPerLane, filters, rrfK = 60 } = request;

    // Apply metadata pre-filter before dispatching lanes.
    const extracted = await this.queryEntityExtractor.extract(rewrittenQuery);
    const preFilter = this.metadataPreFilter.buildFilter(
      rewrittenQuery,
      request.queryClass,
      filters,
      extracted,
      request.strictMetadata ?? false,
    );

    // P3.3 ([RAG-TD-R4-07]): softFilter now travels downstream to the sparse
    // lane as a CASE-based ts_rank_cd multiplier. Non-matching rows stay
    // retrievable; matching rows get a small precision boost. The dense lane
    // still ignores softFilter (its inner RRF has no ranking-boost surface
    // equivalent to ts_rank_cd) — this is intentional.
    const {
      candidateDocIds: _unused,
      appliedMode: _appliedMode,
      softFilter,
      hardFilter,
    } = preFilter;
    const effectiveFilters: SparseSearchFilters = softFilter
      ? {
          ...hardFilter,
          softFilter: {
            ...(softFilter.tickers ? { tickers: softFilter.tickers } : {}),
            ...(softFilter.issuerName ? { issuerName: softFilter.issuerName } : {}),
          },
        }
      : hardFilter;

    // R4.5: determine whether the hard filter carried ticker/issuer hints.
    // The orchestrator owns this check because MetadataPreFilterService cannot
    // distinguish "explicit caller filter" from "entity-extracted hint".
    const hardFilterHadHints =
      (effectiveFilters.tickers?.length ?? 0) > 0 || (effectiveFilters.issuerName?.length ?? 0) > 0;

    this.logger.debug(
      `metadata prefilter: appliedMode=${preFilter.appliedMode} ` +
        `tickers=${JSON.stringify(effectiveFilters.tickers ?? [])} ` +
        `issuerName=${JSON.stringify(effectiveFilters.issuerName ?? [])} ` +
        `fallbackFlag=${extracted.fallbackFlag ?? 'none'}`,
    );

    // Determine variants to run, capped at MAX_VARIANTS.
    const variants = request.variants?.slice(0, MAX_VARIANTS) ?? [
      { kind: 'original' as VariantKind, query: rewrittenQuery },
    ];

    // Initialise lane count accumulators — requested lanes start at 0 so a
    // rejected variant bucket doesn't silently omit the key.
    const laneCounts: Record<string, number> = {};
    for (const lane of lanes) {
      laneCounts[lane] = 0;
    }

    // Run each variant's lanes in parallel.
    const variantPromises = variants.map((variant) =>
      this.runVariantLanes(variant, lanes, topKPerLane, effectiveFilters, request.entityNames),
    );

    const settled = await Promise.allSettled(variantPromises);
    let allLaneResults: RankedCandidate[][] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        for (const laneResult of result.value) {
          allLaneResults.push(laneResult);
          // Accumulate per-lane candidate counts across all variant fan-outs.
          const laneName = laneResult[0]?.lane;
          if (laneName) {
            laneCounts[laneName] = (laneCounts[laneName] ?? 0) + laneResult.length;
          }
        }
      } else {
        this.logger.warn(`Variant lanes failed: ${result.reason}`);
      }
    }

    // R4.5 min-candidates guardrail: if the post-fusion candidate count is below
    // the configured threshold for the query class AND a hard filter with ticker/issuer
    // hints was applied, downgrade to a soft (no-hint) re-run to recover recall.
    const totalCandidates = allLaneResults.reduce((sum, lane) => sum + lane.length, 0);
    if (
      this.metadataPreFilter.shouldDowngrade(
        request.queryClass,
        totalCandidates,
        hardFilterHadHints,
      )
    ) {
      const threshold = request.queryClass
        ? (this.metadataPreFilter.getThreshold(request.queryClass) ?? 0)
        : 0;
      this.logger.warn(
        `metadata prefilter downgraded: class=${request.queryClass} ` +
          `candidates=${totalCandidates} threshold=${threshold} ` +
          `tickers=${JSON.stringify(effectiveFilters.tickers ?? [])} ` +
          `issuerName=${JSON.stringify(effectiveFilters.issuerName ?? [])}`,
      );
      this.metrics?.incrementCounter(
        'rag_metadata_prefilter_downgrade_total',
        'Total metadata prefilter hard→soft downgrades by query class',
        { query_class: request.queryClass! },
      );

      // Strip tickers/issuerName and re-run. NOTE: dense lane (searchRepresentations)
      // never consumed these fields (see [RAG-TD-R4-03] in tech-debt-tracker),
      // so the re-run affects only the sparse lane's WHERE clauses.
      const {
        tickers: _strippedTickers,
        issuerName: _strippedIssuer,
        ...downgradedFilters
      } = effectiveFilters;

      const downgradedPromises = variants.map((variant) =>
        this.runVariantLanes(variant, lanes, topKPerLane, downgradedFilters, request.entityNames),
      );
      const downgradedSettled = await Promise.allSettled(downgradedPromises);
      allLaneResults = [];
      // Reset lane counters for the fresh run.
      for (const lane of lanes) {
        laneCounts[lane] = 0;
      }
      for (const result of downgradedSettled) {
        if (result.status === 'fulfilled') {
          for (const laneResult of result.value) {
            allLaneResults.push(laneResult);
            const laneName = laneResult[0]?.lane;
            if (laneName) {
              laneCounts[laneName] = (laneCounts[laneName] ?? 0) + laneResult.length;
            }
          }
        } else {
          this.logger.warn(`Downgraded variant lanes failed: ${result.reason}`);
        }
      }
    }

    const fused = this.fusion.fuse(allLaneResults, rrfK);
    return { fused, laneCounts };
  }

  /**
   * Run all requested lanes for one query variant and return the candidate lists.
   */
  private async runVariantLanes(
    variant: QueryVariant,
    lanes: Array<'dense' | 'sparse' | 'graph'>,
    topKPerLane: number,
    filters: SparseSearchFilters,
    entityNames?: string[],
  ): Promise<RankedCandidate[][]> {
    const lanePromises: Array<Promise<RankedCandidate[]>> = [];

    if (lanes.includes('dense')) {
      lanePromises.push(this.runDenseLane(variant.query, variant.kind, topKPerLane, filters));
    }

    if (lanes.includes('sparse')) {
      lanePromises.push(this.runSparseLane(variant.query, variant.kind, topKPerLane, filters));
    }

    if (lanes.includes('graph') && this.graphRetrieval && entityNames?.length) {
      lanePromises.push(
        this.graphRetrieval
          .search(entityNames, variant.query, topKPerLane)
          .then((candidates) => candidates.map((c) => ({ ...c, variantKind: variant.kind }))),
      );
    }

    const settled = await Promise.allSettled(lanePromises);
    const results: RankedCandidate[][] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        this.logger.warn(`Lane failed for variant "${variant.kind}": ${result.reason}`);
      }
    }

    return results;
  }

  /**
   * Dense lane: run canonical + contextual_text + sample_question sub-queries
   * concurrently, then apply inner RRF to collapse all hits to one canonical
   * chunkId per representation type before returning.
   */
  private async runDenseLane(
    query: string,
    variantKind: VariantKind,
    topK: number,
    filters: SparseSearchFilters,
  ): Promise<RankedCandidate[]> {
    const queryEmbedding = await this.embeddingService.embedQuery(query);

    const hits = await this.chunkStore.searchRepresentations(queryEmbedding, filters, topK * 4);

    // Inner RRF: group by (representationType), rank within each group,
    // then fuse across groups by canonical chunkId.
    const byRepType = new Map<string, typeof hits>();
    for (const hit of hits) {
      const group = byRepType.get(hit.representationType) ?? [];
      group.push(hit);
      byRepType.set(hit.representationType, group);
    }

    // Sort each group by similarity descending (already ordered by vector distance from DB,
    // but we sort again for safety after grouping).
    for (const group of byRepType.values()) {
      group.sort((a, b) => b.similarity - a.similarity);
    }

    // Fuse across representation groups into one RRF score per chunkId.
    const innerRrfK = 60;
    const innerMap = new Map<
      string,
      { hit: (typeof hits)[0]; rrfScore: number; repTypes: string[] }
    >();

    for (const [repType, group] of byRepType.entries()) {
      for (let rank = 0; rank < group.length; rank++) {
        const hit = group[rank]!;
        const contribution = 1 / (innerRrfK + rank + 1);
        const existing = innerMap.get(hit.chunkId);
        if (existing) {
          existing.rrfScore += contribution;
          if (!existing.repTypes.includes(repType)) {
            existing.repTypes.push(repType);
          }
        } else {
          innerMap.set(hit.chunkId, {
            hit,
            rrfScore: contribution,
            repTypes: [repType],
          });
        }
      }
    }

    // Sort by inner RRF score, take topK.
    const sorted = [...innerMap.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, topK);

    return sorted.map(({ hit, rrfScore, repTypes }) => ({
      chunkId: hit.chunkId,
      sourceId: hit.sourceId,
      content: hit.content,
      metadata: hit.metadata,
      score: rrfScore,
      lane: 'dense' as const,
      variantKind,
      representationType: repTypes,
    }));
  }

  private async runSparseLane(
    query: string,
    variantKind: VariantKind,
    topK: number,
    filters: SparseSearchFilters,
  ): Promise<RankedCandidate[]> {
    const results = await this.sparseSearch.search(query, filters, topK);
    return results.map((r) => ({
      chunkId: r.chunkId,
      sourceId: r.sourceId,
      content: r.content,
      metadata: r.metadata,
      score: r.score,
      lane: 'sparse' as const,
      variantKind,
    }));
  }
}
