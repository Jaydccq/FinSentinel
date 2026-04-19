import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryRewriteService } from './query-rewrite.service';
import { QueryVariantService } from './query-variant.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueryClass = 'factoid' | 'relational' | 'analytical' | 'multi_part';
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
  queryClass: QueryClass;
  variants: QueryVariant[];
  lanes: Array<'dense' | 'sparse' | 'graph'>;
  topKPerLane: number;
  /** Populated when an optional variant generation step fails. */
  fallbackFlags: string[];
}

// ── Classifiers ───────────────────────────────────────────────────────────────

const RELATION_CUES =
  /\b(competitor|supplier|partner|acquired|subsidiary|related|connected|supply chain|board member|invested in|CEO of)\b/i;

const GRAPH_QUERY_PATTERNS =
  /\b(who|which companies|what companies|competitors of|suppliers of|partners of|how .* connected|how .* related)\b/i;

const ANALYTICAL_KEYWORDS =
  /\b(compare|analyze|analyse|explain|summarize|summarise|impact|risk|driver|outlook)\b/i;

const ANALYTICAL_LENGTH_THRESHOLD = 120;

// ── Service ───────────────────────────────────────────────────────────────────

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
    this.rewriteEnabled = configService.get<boolean>('rag.retrieval.queryRewriteEnabled', true) as boolean;
    this.hydeEnabled = configService.get<boolean>('rag.retrieval.hydeEnabled', false) as boolean;
    this.decomposeEnabled = configService.get<boolean>('rag.retrieval.queryDecomposeEnabled', false) as boolean;
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

    // Rewrite variant
    let rewrittenQuery = query;
    if (this.rewriteEnabled && query.trim()) {
      const rewrite = await this.queryRewrite.rewrite(query);
      rewrittenQuery = rewrite;
      if (rewrite !== query) {
        variants.push({ kind: 'rewrite', query: rewrite });
      }
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
      const dedupedSubs = subqueries.filter(
        (sub) => !variants.some((v) => v.query === sub),
      );
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
      queryClass,
      variants,
      lanes,
      topKPerLane,
      fallbackFlags,
    };
  }

  /**
   * Classify the query using regex rules only (no LLM).
   *
   * Precedence: multi_part > analytical > relational > factoid.
   */
  private classifyQuery(query: string): QueryClass {
    if (this.isMultiPart(query)) return 'multi_part';
    if (this.isAnalytical(query)) return 'analytical';
    if (RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query)) return 'relational';
    return 'factoid';
  }

  private isMultiPart(query: string): boolean {
    // Multiple question marks
    const questionMarkCount = (query.match(/\?/g) ?? []).length;
    if (questionMarkCount >= 2) return true;
    // "and" adjacent to a question mark (before or after)
    if (/\?\s*and\b|\band\b[^?]*\?/i.test(query)) return true;
    return false;
  }

  private isAnalytical(query: string): boolean {
    return query.length > ANALYTICAL_LENGTH_THRESHOLD || ANALYTICAL_KEYWORDS.test(query);
  }
}
