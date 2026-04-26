import { isKnownTicker } from './ticker-whitelist';

/**
 * Query classes emitted by the rule classifier.
 *
 * Phase 1.5 (2026-04-26): vocabulary closed against golden v2.2 by adding
 * `numeric` and `summary`. The rule layer can now emit every label the
 * golden set carries.
 *
 * Routing semantics at the planner boundary:
 *   - `numeric` ≈ `factoid`     — skip rewrite, prefer literal tokens at rerank.
 *   - `summary` ≈ `analytical`  — HyDE-eligible, multi-stage orchestration.
 */
export type QueryClass =
  | 'exact_lookup'
  | 'factoid'
  | 'relational'
  | 'analytical'
  | 'multi_part'
  | 'numeric'
  | 'summary'
  | 'colloquial';

export interface RuleClassification {
  class: QueryClass;
  /** 1.0 for hard regex hits, 0.5 for length-only fallback, 0.4 for default fallback. */
  confidence: number;
  /** Which rule fired, for traceability. */
  rule: string;
}

// ── Rule constants (mirrors retrieval-planner.service.ts originals) ─────────

const RELATION_CUES =
  /\b(competitor|supplier|partner|acquired|subsidiary|related|connected|supply chain|board member|invested in|CEO of)\b/i;

const GRAPH_QUERY_PATTERNS =
  /\b(who|which companies|what companies|competitors of|suppliers of|partners of|how .* connected|how .* related)\b/i;

const ANALYTICAL_KEYWORDS =
  /\b(compare|analyze|analyse|explain|summarize|summarise|impact|risk|driver|outlook)\b/i;

const ANALYTICAL_LENGTH_THRESHOLD = 120;

/** ALLCAPS token that could be a ticker (2-5 uppercase letters). Case-sensitive. */
const TICKER_CANDIDATE = /\b[A-Z]{2,5}\b/g;

/** Time anchor: Q1-Q4, FY, or a 4-digit 2000-series year. */
const TIME_ANCHOR = /\b(?:Q[1-4]|FY\d{2,4}|20\d{2})\b/;

/** Section / item / note / part identifiers commonly used in filings and legal text. */
const SECTION_IDENTIFIER = /\b(?:Item\s+\d+[A-Z]?|Section\s+\d+(?:\.\d+)*|Note\s+\d+|Part\s+[IVX]+)\b/i;

/** Numeric / structured identifiers: ISIN, CUSIP, EPS, P/E. */
const NUMERIC_IDENTIFIER = /\bISIN\s+[A-Z0-9]{12}\b|\bCUSIP\s+[A-Z0-9]{9}\b|\bEPS\b|\bP\/E\b/;

/** Double-quoted phrase with at least 3 chars inside. */
const QUOTED_PHRASE = /"[^"]{3,}"/;

/** Document-type keywords (kept here for legacy reference; no longer the
 *  triple-gate fallback after phase 1.5 tightening). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DOC_TYPE_KEYWORDS = /\b(revenue|earnings|10-?K|10-?Q|8-?K|filing|report|guidance)\b/i;

/**
 * Numeric-metric query: financial ratios / per-share metrics / margin /
 * growth / market cap / price target. Narrow on purpose — every term here
 * is a finance-specific metric, not a general English noun.
 */
const NUMERIC_QUERY =
  /\b(EPS|earnings per share|P\/?E ratio|diluted EPS|revenue per share|growth rate|operating margin|gross margin|net margin|price target|market cap)\b/i;

/**
 * Summary intent: explicit "give me an overview" requests. Ordered ahead of
 * analytical-keyword so `tell me about` / `summary of` don't get pulled into
 * the analytical bucket via `summarize`.
 */
const SUMMARY_INTENT =
  /\b(summary of|give me a (quick )?rundown|tldr|tl;dr|brief overview|short summary|what does .{1,80} do\??|tell me about|explain in (one|short))\b/i;

/** Chat/greeting openers with no retrieval intent. */
const COLLOQUIAL_OPENERS =
  /^\s*(hi|hello|hey|yo|sup|thanks?|thank\s+you|ty|tysm|bye|goodbye|ok(ay)?|cool|lol|nice|got\s+it|sounds\s+good|help(?:\s+me)?)[\s!?.,]*$/i;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Pure rule-based classifier. No I/O, no LLM. Deterministic on input.
 *
 * Precedence (phase 1.5):
 *   exact_lookup > multi_part > numeric > summary > relational
 *     > analytical_keyword > analytical_length > colloquial > factoid
 *
 * Phase 1.5 changes vs phase 1:
 *   - Added `numeric` and `summary` ahead of analytical to close the
 *     vocabulary gap on golden v2.2.
 *   - Moved `relational` ahead of length-based analytical fallback so
 *     a hard relational regex hit isn't lost on long queries.
 *   - Tightened `exact_lookup` triple-gate (see {@link isExactLookup}).
 */
export function classifyByRules(query: string): RuleClassification {
  if (isExactLookup(query)) {
    return { class: 'exact_lookup', confidence: 1.0, rule: 'exact_lookup' };
  }
  if (isMultiPart(query)) {
    return { class: 'multi_part', confidence: 1.0, rule: 'multi_part' };
  }
  if (NUMERIC_QUERY.test(query)) {
    return { class: 'numeric', confidence: 1.0, rule: 'numeric' };
  }
  if (SUMMARY_INTENT.test(query)) {
    return { class: 'summary', confidence: 1.0, rule: 'summary' };
  }
  if (RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query)) {
    return { class: 'relational', confidence: 1.0, rule: 'relational' };
  }
  if (ANALYTICAL_KEYWORDS.test(query)) {
    return { class: 'analytical', confidence: 1.0, rule: 'analytical_keyword' };
  }
  if (query.length > ANALYTICAL_LENGTH_THRESHOLD) {
    return { class: 'analytical', confidence: 0.5, rule: 'analytical_length' };
  }
  if (COLLOQUIAL_OPENERS.test(query)) {
    return { class: 'colloquial', confidence: 1.0, rule: 'colloquial' };
  }
  return { class: 'factoid', confidence: 0.4, rule: 'fallback' };
}

// ── Internals ───────────────────────────────────────────────────────────────

/**
 * Heuristic test for `exact_lookup` — deterministic, regex-only, no LLM.
 *
 * Any of these fires:
 *   1. Section / item / note / part identifier (filings pattern).
 *   2. Numeric identifier (ISIN, CUSIP, EPS, P/E).
 *   3. Double-quoted phrase with 3+ chars inside.
 *   4. Ticker candidate that PASSES the curated whitelist + a time anchor.
 *
 * Phase 1.5 tightening: the previous "ticker candidate + time anchor +
 * doc-type keyword" triple-gate caught factoid questions like
 * `"What was Tesla revenue in 2025"` because `revenue` plus a year plus an
 * incidental ALLCAPS token (`TSLA`-not-quoted-but-matches-regex elsewhere)
 * was enough. The fallback for long-tail / non-whitelisted tickers now
 * requires either a section identifier or a quoted phrase — both of which
 * are already covered by the earlier hard checks. So in practice this means
 * non-whitelisted ticker candidates no longer push a query into
 * `exact_lookup` on the strength of doc-type keywords alone; the query
 * falls through to factoid and gets normal rewrite + rerank treatment.
 */
function isExactLookup(query: string): boolean {
  if (SECTION_IDENTIFIER.test(query)) return true;
  if (NUMERIC_IDENTIFIER.test(query)) return true;
  if (QUOTED_PHRASE.test(query)) return true;

  const hasTimeAnchor = TIME_ANCHOR.test(query);
  if (!hasTimeAnchor) return false;

  const candidates = Array.from(query.matchAll(TICKER_CANDIDATE), (m) => m[0]);
  if (candidates.length === 0) return false;

  // Whitelisted-ticker single-gate: still strict (whitelist + time anchor).
  const whitelisted = candidates.some((c) => isKnownTicker(c));
  if (whitelisted) return true;

  // Phase 1.5 tightened fallback: doc-type keyword alone is no longer
  // enough to upgrade an unknown ticker candidate to exact_lookup.
  // The earlier checks (SECTION_IDENTIFIER / QUOTED_PHRASE) already cover
  // the precise-lookup cases; if neither fired we bail out.
  return false;
}

function isMultiPart(query: string): boolean {
  const questionMarkCount = (query.match(/\?/g) ?? []).length;
  if (questionMarkCount >= 2) return true;
  if (/\?\s*and\b|\band\b[^?]*\?/i.test(query)) return true;
  return false;
}
