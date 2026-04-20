import { Injectable } from '@nestjs/common';
import type { QueryClass } from './retrieval-planner.service';
import type { SparseSearchFilters } from './sparse-search.service';
import type { ExtractedEntities } from './query-entity-extractor.service';

export type PreFilterMode = 'off' | 'soft' | 'hard';

export interface PreFilterConfig {
  mode: PreFilterMode;
  /** Confidence threshold that determines hard vs. soft bucket in 'soft' mode, and inclusion vs. drop in 'hard' mode. */
  hardMinConfidence: number;
  /** Reserved for R4.5 min-candidates guardrail — unused in R4.2. */
  minCandidatesByClass: Partial<Record<QueryClass, number>>;
}

export interface PreFilter {
  /**
   * Filters that must be satisfied by retrieval lanes (SQL-level restriction in R4.3+).
   * In R4.2 the tickers/issuerName fields are populated but not yet consumed by SQL.
   */
  hardFilter: SparseSearchFilters & { tickers?: string[]; issuerName?: string[] };
  /**
   * Filters that represent lower-confidence extraction — used as soft hints to
   * boost or re-rank rather than hard restrict. Only set when at least one
   * low-confidence hit exists.
   */
  softFilter?: SparseSearchFilters & { tickers?: string[]; issuerName?: string[] };
  /**
   * When non-empty, both dense and sparse lanes restrict source_id to this set.
   * Unused in R4.2 — populated in R4.3+.
   */
  candidateDocIds: string[];
  /** Reflects the effective mode after null/off handling. */
  appliedMode: PreFilterMode;
}

@Injectable()
export class MetadataPreFilterService {
  constructor(private readonly config: PreFilterConfig) {}

  /**
   * Build a pre-filter for the retrieval lanes.
   *
   * @param _query       - raw query text (unused in R4.2; forwarded in R4.3+)
   * @param _queryClass  - classified query shape (reserved for R4.5 per-class guardrail)
   * @param explicitFilters - caller-supplied filters always propagated to hardFilter
   * @param extracted    - entity extraction result; null → mode collapses to 'off'
   */
  buildFilter(
    _query: string,
    _queryClass: QueryClass | undefined,
    explicitFilters: SparseSearchFilters,
    extracted: ExtractedEntities | null,
  ): PreFilter {
    // mode=off OR null extracted → pass through explicit filters only
    if (this.config.mode === 'off' || extracted === null) {
      return {
        hardFilter: { ...explicitFilters },
        candidateDocIds: [],
        appliedMode: 'off',
      };
    }

    const { hardMinConfidence } = this.config;

    const highTickers = extracted.tickers
      .filter((t) => t.confidence >= hardMinConfidence)
      .map((t) => t.value);
    const lowTickers = extracted.tickers
      .filter((t) => t.confidence < hardMinConfidence)
      .map((t) => t.value);
    const highIssuers = extracted.issuerNames
      .filter((t) => t.confidence >= hardMinConfidence)
      .map((t) => t.value);
    const lowIssuers = extracted.issuerNames
      .filter((t) => t.confidence < hardMinConfidence)
      .map((t) => t.value);

    const hardFilter: SparseSearchFilters & { tickers?: string[]; issuerName?: string[] } = {
      ...explicitFilters,
      ...(highTickers.length ? { tickers: highTickers } : {}),
      ...(highIssuers.length ? { issuerName: highIssuers } : {}),
    };

    if (this.config.mode === 'hard') {
      // In hard mode, only above-threshold hits are promoted; below-threshold are dropped.
      // softFilter is intentionally suppressed.
      return {
        hardFilter,
        candidateDocIds: [],
        appliedMode: 'hard',
      };
    }

    // mode === 'soft'
    let softFilter: (SparseSearchFilters & { tickers?: string[]; issuerName?: string[] }) | undefined;
    if (lowTickers.length + lowIssuers.length > 0) {
      softFilter = {
        ...(lowTickers.length ? { tickers: lowTickers } : {}),
        ...(lowIssuers.length ? { issuerName: lowIssuers } : {}),
      };
    }

    return {
      hardFilter,
      ...(softFilter !== undefined ? { softFilter } : {}),
      candidateDocIds: [],
      appliedMode: 'soft',
    };
  }
}
