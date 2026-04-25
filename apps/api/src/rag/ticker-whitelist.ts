/**
 * Ticker whitelist for exact_lookup query classification (R3.1).
 *
 * ── Decision: Option C (curated minimum viable list) ──
 *
 * The original plan wanted a real whitelist sourced from `packages/db` market
 * data, but investigation confirmed:
 *   - `packages/db/src/schema/` has only `watchlist_items` and `holdings`,
 *     which are user state (per-user rows), NOT a market-wide reference
 *     table.
 *   - `apps/api/src/market/providers/*` call external HTTP providers
 *     (Yahoo / Polygon / FMP); they are not cheap for the RAG hot path.
 *
 * Option A (real whitelist) is therefore unavailable. This file ships the
 * minimum viable curated list of 50 highly traded US large-caps so the
 * regex-based classifier can answer `isTicker(candidate)` in O(1) without
 * any I/O.
 *
 * Long-tail tickers (mid/small-cap, international, ADRs) are covered by the
 * triple-gate fallback in `retrieval-planner.service.ts` —
 * ticker-candidate + time anchor + doc_type keyword (revenue/earnings/
 * 10-K/10-Q/filing/report) — so a user query like "XYZ Q4 2025 earnings"
 * still classifies as exact_lookup even if XYZ isn't in this list, while
 * an ALLCAPS English word like "THE Q4 2025" correctly falls through.
 *
 * ── Future work ──
 *
 * Replace with a DB-backed lookup once `packages/db` gains a market-wide
 * `instruments` / `securities` reference table. At that point this file
 * should become a thin adapter that caches the DB list in memory, keeping
 * the same O(1) `isKnownTicker()` contract.
 */

/** Top US large-caps and widely traded ETFs (50 symbols). */
const KNOWN_TICKERS = new Set<string>([
  // Mega-cap tech
  'AAPL',
  'MSFT',
  'GOOGL',
  'GOOG',
  'AMZN',
  'META',
  'NVDA',
  'TSLA',
  // Other large-cap tech / platforms
  'NFLX',
  'ADBE',
  'CRM',
  'ORCL',
  'INTC',
  'AMD',
  'AVGO',
  'CSCO',
  'QCOM',
  'TXN',
  'IBM',
  'SAP',
  // Financials
  'JPM',
  'BAC',
  'WFC',
  'C',
  'GS',
  'MS',
  'BLK',
  'V',
  'MA',
  'PYPL',
  // Consumer / retail / staples
  'WMT',
  'HD',
  'NKE',
  'COST',
  'MCD',
  'SBUX',
  'PEP',
  'KO',
  'PG',
  // Healthcare / pharma
  'JNJ',
  'PFE',
  'UNH',
  'LLY',
  'MRK',
  'ABBV',
  // Energy / industrial
  'XOM',
  'CVX',
  // Broad-market ETFs
  'SPY',
  'QQQ',
  'IWM',
]);

/**
 * Returns true if `candidate` is a known ticker symbol.
 *
 * Case-sensitive: the caller is expected to pass an ALLCAPS candidate
 * from `\b[A-Z]{2,5}\b` already, so we preserve that contract and avoid
 * an unnecessary `toUpperCase()` allocation per call.
 */
export function isKnownTicker(candidate: string): boolean {
  return KNOWN_TICKERS.has(candidate);
}
