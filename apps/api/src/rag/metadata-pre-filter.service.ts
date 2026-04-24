import { Injectable } from '@nestjs/common';
import type { QueryClass } from './retrieval-planner.service';
import type { SparseSearchFilters } from './sparse-search.service';
import type { ExtractedEntities } from './query-entity-extractor.service';

/**
 * Format a Date as YYYY-MM-DD in UTC. Matches the shape that
 * SparseSearchService compares against `metadata->>'date'` (which is stored
 * as an ISO date string by the ingestion pipeline). Module-scoped so the
 * small cost of declaring it is not paid on every buildFilter call.
 */
function formatIsoDate(d: Date): string {
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

/**
 * Return the value of the highest-confidence entity hit, or undefined when
 * the array is empty. Used by the soft-filter sector/region surfacing —
 * we currently take a single top-1 hint rather than the whole list because
 * the SparseSearchFilters.softFilter.sector field is singular.
 */
function pickTop(
  hits: Array<{ value: string; confidence: number }> | undefined,
): string | undefined {
  if (!hits || hits.length === 0) return undefined;
  let best = hits[0]!;
  for (let i = 1; i < hits.length; i++) {
    if (hits[i]!.confidence > best.confidence) best = hits[i]!;
  }
  return best.value;
}

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

    // P1-3 (2026-04-24): sector + region are now surfaced as SOFT hints —
    // they boost matching rows but never exclude. HARD SQL pushdown stays
    // deferred per the codex consult: default soft, opt-in `strict_metadata=true`
    // is planned but doesn't ship in this slice.
    const topSector = pickTop(extracted.sectors);
    const topRegion = pickTop(extracted.regions);

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

    // P3.1 ([RAG-TD-R4-06]): promote high-confidence docType / timeRange into
    // hardFilter. Explicit caller-supplied filters win on conflict, so put
    // extracted values BEFORE the explicit spread below.
    const extractedDocType =
      extracted.docType && extracted.docType.confidence >= hardMinConfidence
        ? extracted.docType.value
        : undefined;
    const extractedAfterDate =
      extracted.timeRange &&
      extracted.timeRange.after !== undefined &&
      extracted.timeRange.confidence >= hardMinConfidence
        ? formatIsoDate(extracted.timeRange.after)
        : undefined;

    const hardFilter: SparseSearchFilters & { tickers?: string[]; issuerName?: string[] } = {
      ...(extractedDocType ? { docType: extractedDocType } : {}),
      ...(extractedAfterDate ? { afterDate: extractedAfterDate } : {}),
      ...explicitFilters, // explicit wins on conflict
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
    const hasSoftHint =
      lowTickers.length + lowIssuers.length > 0 ||
      topSector !== undefined ||
      topRegion !== undefined;
    if (hasSoftHint) {
      softFilter = {
        ...(lowTickers.length ? { tickers: lowTickers } : {}),
        ...(lowIssuers.length ? { issuerName: lowIssuers } : {}),
        ...(topSector ? { sector: topSector } : {}),
        ...(topRegion ? { regionId: topRegion } : {}),
      };
    }

    return {
      hardFilter,
      ...(softFilter !== undefined ? { softFilter } : {}),
      candidateDocIds: [],
      appliedMode: 'soft',
    };
  }

  /**
   * Return the minimum-candidates threshold configured for a given query class,
   * or `undefined` when no threshold is set (in which case the guardrail is off).
   * Exposed as a narrow helper so the orchestrator's WARN log can surface the
   * threshold value without reaching into the private `config` field.
   */
  getThreshold(queryClass: QueryClass): number | undefined {
    return this.config.minCandidatesByClass[queryClass];
  }

  /**
   * Check whether a candidate count meets the minimum threshold for the given
   * query class. When it doesn't, the orchestrator should re-run retrieval
   * without the hard ticker/issuer filter.
   *
   * Returns `true` when the count is below threshold AND a hard filter was
   * actually applied (downgrade needed).
   * Returns `false` when the count is adequate, when no class is provided,
   * or when the hard filter had no hints (no point downgrading).
   *
   * `queryClass === undefined` short-circuits to `false` (no class, no threshold).
   */
  shouldDowngrade(
    queryClass: QueryClass | undefined,
    candidateCount: number,
    hardFilterHadHints: boolean,
  ): boolean {
    if (!queryClass || !hardFilterHadHints) return false;
    const threshold = this.config.minCandidatesByClass[queryClass];
    if (threshold === undefined || threshold <= 0) return false;
    return candidateCount < threshold;
  }
}
