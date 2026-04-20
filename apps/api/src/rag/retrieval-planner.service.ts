import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryRewriteService } from './query-rewrite.service';
import { QueryVariantService } from './query-variant.service';
import { isKnownTicker } from './ticker-whitelist';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueryClass =
  | 'exact_lookup'
  | 'factoid'
  | 'relational'
  | 'analytical'
  | 'multi_part';
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

// ── exact_lookup heuristics (R3.1) ────────────────────────────────────────────

/** ALLCAPS token that could be a ticker (2-5 uppercase letters). Case-sensitive. */
const TICKER_CANDIDATE = /\b[A-Z]{2,5}\b/g;

/** Time anchor: Q1-Q4, FY, or a 4-digit 2000-series year. */
const TIME_ANCHOR = /\b(?:Q[1-4]|FY\d{2,4}|20\d{2})\b/;

/**
 * Section / item / note identifiers commonly used in filings and legal text
 * (e.g. "Item 1A", "Section 2.1", "Note 15"). Case-insensitive.
 */
const SECTION_IDENTIFIER = /\b(?:Item\s+\d+[A-Z]?|Section\s+\d+(?:\.\d+)*|Note\s+\d+)\b/i;

/**
 * Numeric / structured identifiers: ISIN, CUSIP, and precise financial
 * metric tokens (EPS, P/E). ISIN and CUSIP are case-sensitive by standard.
 */
const NUMERIC_IDENTIFIER =
  /\bISIN\s+[A-Z0-9]{12}\b|\bCUSIP\s+[A-Z0-9]{9}\b|\bEPS\b|\bP\/E\b/;

/** Double-quoted phrase with at least 3 chars inside. */
const QUOTED_PHRASE = /"[^"]{3,}"/;

/**
 * Document-type keywords used by the triple-gate fallback when a ticker
 * candidate is not in the curated whitelist. Requiring one of these next
 * to a ticker + time-anchor blocks false positives like "THE Q4 2025"
 * while still covering long-tail ticker queries like "XYZ Q4 2025 revenue".
 */
const DOC_TYPE_KEYWORDS = /\b(revenue|earnings|10-?K|10-?Q|8-?K|filing|report|guidance)\b/i;

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
   * Precedence: exact_lookup > multi_part > analytical > relational > factoid.
   */
  private classifyQuery(query: string): QueryClass {
    if (this.isExactLookup(query)) return 'exact_lookup';
    if (this.isMultiPart(query)) return 'multi_part';
    if (this.isAnalytical(query)) return 'analytical';
    if (RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query)) return 'relational';
    return 'factoid';
  }

  /**
   * Heuristic test for `exact_lookup` — deterministic, regex-only, no LLM.
   *
   * Any of these fires:
   *   1. A ticker candidate that PASSES the curated whitelist + a time anchor.
   *   2. A section / item / note identifier (filings pattern).
   *   3. A numeric identifier (ISIN, CUSIP, EPS, P/E).
   *   4. A double-quoted phrase with 3+ chars inside.
   *   5. Triple-gate fallback: ticker candidate + time anchor + doc-type
   *      keyword, for long-tail tickers not in the curated whitelist.
   *      This covers "XYZ Q4 2025 revenue" while blocking "THE Q4 2025".
   */
  private isExactLookup(query: string): boolean {
    if (SECTION_IDENTIFIER.test(query)) return true;
    if (NUMERIC_IDENTIFIER.test(query)) return true;
    if (QUOTED_PHRASE.test(query)) return true;

    const hasTimeAnchor = TIME_ANCHOR.test(query);
    if (!hasTimeAnchor) return false;

    // Collect ALLCAPS candidates. `matchAll` with a /g regex gives each
    // match; we inspect them against the curated whitelist first (Option C),
    // then against the triple-gate fallback (Option B) for long-tail symbols.
    const candidates = Array.from(query.matchAll(TICKER_CANDIDATE), (m) => m[0]);
    if (candidates.length === 0) return false;

    const whitelisted = candidates.some((c) => isKnownTicker(c));
    if (whitelisted) return true;

    // Triple-gate fallback: any ticker candidate + doc-type keyword next to
    // the already-confirmed time anchor. Blocks false positives from ALLCAPS
    // English words (THE, ANY, FOR, YOU, ...) without a financial context.
    return DOC_TYPE_KEYWORDS.test(query);
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
