import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryRewriteService } from './query-rewrite.service';
import { QueryVariantService } from './query-variant.service';
import { classifyByRules, type QueryClass } from './query-classifier-rules';

// ── Types ─────────────────────────────────────────────────────────────────────

export type { QueryClass };
export type VariantKind = 'original' | 'rewrite' | 'hyde' | 'subquery';

export interface QueryVariant {
  kind: VariantKind;
  query: string;
  /** Reserved for future RRF per-variant weighting. Default 1.0. */
  weight?: number;
}

export interface RetrievalPlan {
  originalQuery: string;
  /** Kept for backward compatibility with T5's orchestrator (plan.rewrittenQuery). */
  rewrittenQuery: string;
  /**
   * Query text the reranker should score candidates against.
   *
   * R3.3 selection rule:
   *   - `exact_lookup` → `originalQuery` (literal tokens must survive)
   *   - else → `rewrittenQuery` (paraphrase aids semantic rerank),
   *     with fallback to `originalQuery` when `rewrittenQuery` is empty.
   *
   * Always non-empty when the input query is non-empty — guarantees the
   * reranker sidecar never receives an empty string.
   */
  rerankQuery: string;
  queryClass: QueryClass;
  variants: QueryVariant[];
  lanes: Array<'dense' | 'sparse' | 'graph'>;
  topKPerLane: number;
  /** Populated when an optional variant generation step fails. */
  fallbackFlags: string[];
}

// ── Service ───────────────────────────────────────────────────────────────────
//
// Rule-based classification lives in `query-classifier-rules.ts`. The planner
// is a thin caller; behavior-preserving refactor (2026-04-26).

@Injectable()
export class RetrievalPlannerService {
  private readonly logger = new Logger(RetrievalPlannerService.name);
  private readonly graphEnabled: boolean;
  private readonly rewriteEnabled: boolean;
  private readonly hydeEnabled: boolean;
  private readonly decomposeEnabled: boolean;

  constructor(
    private readonly queryRewrite: QueryRewriteService,
    private readonly queryVariant: QueryVariantService,
    configService: ConfigService,
  ) {
    // Graph lane is disabled by default until graph enrichment pipeline is implemented
    this.graphEnabled = configService.get<boolean>('rag.graph.enabled', false) as boolean;
    this.rewriteEnabled = configService.get<boolean>(
      'rag.retrieval.queryRewriteEnabled',
      true,
    ) as boolean;
    this.hydeEnabled = configService.get<boolean>('rag.retrieval.hydeEnabled', false) as boolean;
    this.decomposeEnabled = configService.get<boolean>(
      'rag.retrieval.queryDecomposeEnabled',
      false,
    ) as boolean;
  }

  async plan(query: string, topKPerLane = 20): Promise<RetrievalPlan> {
    const fallbackFlags: string[] = [];

    // Classify query using regex -- no LLM for v1
    const queryClass = this.classifyQuery(query);

    // Lane selection
    const lanes: Array<'dense' | 'sparse' | 'graph'> = ['dense', 'sparse'];
    if (this.graphEnabled && queryClass === 'relational') {
      lanes.push('graph');
    }

    // Build variants -- original is always first
    const variants: QueryVariant[] = [{ kind: 'original', query }];

    // Rewrite variant.
    // R3.2: exact_lookup queries contain precise literal tokens (tickers,
    // filings sections, ISIN/CUSIP, quoted phrases). Rewriting those tokens
    // dilutes precision, so we skip rewrite entirely for that class —
    // regardless of RAG_QUERY_REWRITE_ENABLED.
    let rewrittenQuery = query;
    const shouldRewrite =
      this.rewriteEnabled && queryClass !== 'exact_lookup' && query.trim().length > 0;
    if (shouldRewrite) {
      const rewrite = await this.queryRewrite.rewrite(query);
      rewrittenQuery = rewrite;
      if (rewrite !== query) {
        variants.push({ kind: 'rewrite', query: rewrite });
      }
    }

    // R3.3: rerankQuery selection.
    // - exact_lookup → originalQuery (preserve literal tickers/filings/quotes)
    // - else → rewrittenQuery, falling back to originalQuery when the
    //   rewriter is disabled or returned an empty string.
    const rerankQuery = this.selectRerankQuery(queryClass, query, rewrittenQuery);

    // R3.2: exact_lookup short-circuits BEFORE the HyDE and decompose
    // branches are even considered. The branches below gate on
    // `queryClass === 'analytical'` / `'multi_part'` respectively, which
    // already excludes exact_lookup by precedence — but we make the
    // intent explicit here so a future refactor that widens either class
    // gate cannot accidentally re-enable expansion for exact_lookup.
    if (queryClass === 'exact_lookup') {
      return {
        originalQuery: query,
        rewrittenQuery,
        rerankQuery,
        queryClass,
        variants,
        lanes,
        topKPerLane,
        fallbackFlags,
      };
    }

    // HyDE variant -- analytical class only, gated by flag
    if (queryClass === 'analytical' && this.hydeEnabled) {
      const hydePassage = await this.queryVariant.hyde(query);
      if (hydePassage !== null) {
        variants.push({ kind: 'hyde', query: hydePassage });
      } else {
        fallbackFlags.push('hyde_failed');
      }
    }

    // Decompose variant -- multi_part class only, gated by flag
    if (queryClass === 'multi_part' && this.decomposeEnabled) {
      const subqueries = await this.queryVariant.decompose(query);
      const dedupedSubs = subqueries.filter((sub) => !variants.some((v) => v.query === sub));
      if (dedupedSubs.length > 0) {
        for (const sub of dedupedSubs) {
          variants.push({ kind: 'subquery', query: sub });
        }
      } else {
        fallbackFlags.push('decompose_failed');
      }
    }

    return {
      originalQuery: query,
      rewrittenQuery,
      rerankQuery,
      queryClass,
      variants,
      lanes,
      topKPerLane,
      fallbackFlags,
    };
  }

  /**
   * R3.3: select the query text the reranker should score against.
   *
   * - `exact_lookup` → the literal `originalQuery` (never paraphrase
   *   tickers, filings sections, ISIN/CUSIP, or quoted phrases).
   * - anything else → `rewrittenQuery` when non-empty, else
   *   `originalQuery` as a safety fallback so we never ship an empty
   *   string to the reranker sidecar.
   */
  private selectRerankQuery(
    queryClass: QueryClass,
    originalQuery: string,
    rewrittenQuery: string,
  ): string {
    if (queryClass === 'exact_lookup') return originalQuery;
    return rewrittenQuery.length > 0 ? rewrittenQuery : originalQuery;
  }

  /**
   * Classify the query using regex rules only (no LLM).
   *
   * Delegates to the pure module {@link classifyByRules}. Kept as a thin
   * private wrapper to preserve the planner's public surface and to make
   * future swaps (e.g. shadow LLM classifier) localised.
   */
  private classifyQuery(query: string): QueryClass {
    return classifyByRules(query).class;
  }
}
