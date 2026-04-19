import { Injectable } from '@nestjs/common';
import type { QueryClass } from './retrieval-planner.service';
import type { SparseSearchFilters } from './sparse-search.service';

/**
 * Metadata pre-filter service (v1 seam).
 *
 * v1 passes explicit filters through unchanged and returns an empty
 * candidateDocIds list. Future versions can populate candidateDocIds
 * from LLM entity extraction, summary-match pre-screening, or
 * keyword_entity representation lookups.
 */
export interface PreFilter extends SparseSearchFilters {
  /**
   * When non-empty, both dense and sparse lanes restrict source_id to this
   * set. Unused in v1 -- all IDs accepted.
   */
  candidateDocIds: string[];
}

@Injectable()
export class MetadataPreFilterService {
  /**
   * Build a pre-filter for the retrieval lanes.
   *
   * @param _query - raw query text (reserved for future entity extraction)
   * @param _queryClass - classified query shape (reserved for future routing)
   * @param explicitFilters - caller-supplied filters passed through as-is
   */
  buildFilter(
    _query: string,
    _queryClass: QueryClass | undefined,
    explicitFilters: SparseSearchFilters,
  ): PreFilter {
    return {
      ...explicitFilters,
      // v1: no entity extraction, no summary pre-screening
      candidateDocIds: [],
    };
  }
}
