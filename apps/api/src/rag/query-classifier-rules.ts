import { isKnownTicker } from './ticker-whitelist';

/**
 * Query classes emitted by the rule classifier.
 *
 * NOTE: this vocabulary is intentionally narrower than the labelled golden
 * dataset (which also has `numeric` and `summary`). The eval-runner shadow
 * report surfaces that gap; extending the rule vocabulary is a separate
 * planner-policy decision (see plan
 * `docs/exec-plans/2026-04-26-query-classifier-shadow-phase1.md`).
 */
export type QueryClass =
  | 'exact_lookup'
  | 'factoid'
  | 'relational'
  | 'analytical'
  | 'multi_part'
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

/** Section / item / note identifiers commonly used in filings and legal text. */
const SECTION_IDENTIFIER = /\b(?:Item\s+\d+[A-Z]?|Section\s+\d+(?:\.\d+)*|Note\s+\d+)\b/i;

/** Numeric / structured identifiers: ISIN, CUSIP, EPS, P/E. */
const NUMERIC_IDENTIFIER = /\bISIN\s+[A-Z0-9]{12}\b|\bCUSIP\s+[A-Z0-9]{9}\b|\bEPS\b|\bP\/E\b/;

/** Double-quoted phrase with at least 3 chars inside. */
const QUOTED_PHRASE = /"[^"]{3,}"/;

/** Document-type keywords used by the triple-gate fallback. */
const DOC_TYPE_KEYWORDS = /\b(revenue|earnings|10-?K|10-?Q|8-?K|filing|report|guidance)\b/i;

/** Chat/greeting openers with no retrieval intent. */
const COLLOQUIAL_OPENERS =
  /^\s*(hi|hello|hey|yo|sup|thanks?|thank\s+you|ty|tysm|bye|goodbye|ok(ay)?|cool|lol|nice|got\s+it|sounds\s+good|help(?:\s+me)?)[\s!?.,]*$/i;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Pure rule-based classifier. No I/O, no LLM. Deterministic on input.
 *
 * Precedence (preserved byte-for-byte from the original
 * `RetrievalPlannerService.classifyQuery` implementation):
 *   exact_lookup > multi_part > analytical > relational > colloquial > factoid
 *
 * `colloquial` sits below structural checks so a one-word ticker like "AAPL"
 * still falls through to `factoid` (not `colloquial`).
 */
export function classifyByRules(query: string): RuleClassification {
  if (isExactLookup(query)) {
    return { class: 'exact_lookup', confidence: 1.0, rule: 'exact_lookup' };
  }
  if (isMultiPart(query)) {
    return { class: 'multi_part', confidence: 1.0, rule: 'multi_part' };
  }
  if (ANALYTICAL_KEYWORDS.test(query)) {
    return { class: 'analytical', confidence: 1.0, rule: 'analytical_keyword' };
  }
  if (query.length > ANALYTICAL_LENGTH_THRESHOLD) {
    return { class: 'analytical', confidence: 0.5, rule: 'analytical_length' };
  }
  if (RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query)) {
    return { class: 'relational', confidence: 1.0, rule: 'relational' };
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
 *   1. Section / item / note identifier (filings pattern).
 *   2. Numeric identifier (ISIN, CUSIP, EPS, P/E).
 *   3. Double-quoted phrase with 3+ chars inside.
 *   4. Ticker candidate that PASSES the curated whitelist + a time anchor.
 *   5. Triple-gate fallback: ticker candidate + time anchor + doc-type
 *      keyword, for long-tail tickers not in the curated whitelist.
 */
function isExactLookup(query: string): boolean {
  if (SECTION_IDENTIFIER.test(query)) return true;
  if (NUMERIC_IDENTIFIER.test(query)) return true;
  if (QUOTED_PHRASE.test(query)) return true;

  const hasTimeAnchor = TIME_ANCHOR.test(query);
  if (!hasTimeAnchor) return false;

  const candidates = Array.from(query.matchAll(TICKER_CANDIDATE), (m) => m[0]);
  if (candidates.length === 0) return false;

  const whitelisted = candidates.some((c) => isKnownTicker(c));
  if (whitelisted) return true;

  return DOC_TYPE_KEYWORDS.test(query);
}

function isMultiPart(query: string): boolean {
  const questionMarkCount = (query.match(/\?/g) ?? []).length;
  if (questionMarkCount >= 2) return true;
  if (/\?\s*and\b|\band\b[^?]*\?/i.test(query)) return true;
  return false;
}
