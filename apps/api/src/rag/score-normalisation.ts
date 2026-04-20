/**
 * Score normalisation helpers for multi-stage RAG results.
 *
 * R3.5 — `RagSearchResult.similarity` stays REQUIRED on all paths so
 * downstream consumers (notably `news-analysis.service.ts:120`,
 * `result.similarity * 100` percentage formatting) keep working after the
 * multi-stage pipeline replaces raw cosine similarity with reranker / RRF
 * scores. Raw reranker scores from BGE-style cross-encoders are unbounded
 * (typically in roughly [-10, +10]) and RRF fused scores are bounded in
 * (0, ~0.2] given our k=60 and ≤12 lane-variant hits per chunk. We pick
 * ONE normalisation for each source so the contract is simple:
 *
 *   - Reranker scores  → sigmoid(x) = 1 / (1 + e^-x).
 *     Bounded in (0, 1), strictly monotonic, stable across batch sizes,
 *     and the standard published practice for cross-encoder score
 *     normalisation. Fixed temperature = 1.0 (no env knob) until eval
 *     data proves otherwise.
 *
 *   - RRF scores       → identity with clamp to [0, 1].
 *     RRF values are already in a bounded range by construction, so
 *     identity preserves their ranks; clamp is defence-in-depth against
 *     future tuning of k or lane counts. We deliberately do NOT sigmoid
 *     these because sigmoid of [0, 0.2] compresses everything into
 *     [0.5, 0.55] which destroys visible ranking separation in the
 *     `N.N% match` UI.
 *
 * Both helpers are pure, synchronous, and side-effect free so they're
 * safe to call in hot paths.
 */

/**
 * Sigmoid(x) = 1 / (1 + e^-x). Maps ℝ → (0, 1), strictly monotonic,
 * sigmoid(0) = 0.5. Handles very large |x| without NaN/Infinity by
 * relying on Math.exp saturating (e^-1000 → 0, e^1000 → Infinity, but
 * 1/(1+Infinity) = 0 which is still a finite number in (0, 1)).
 */
export function normaliseRerankScore(rawScore: number): number {
  if (!Number.isFinite(rawScore)) {
    // Guard against NaN/±Infinity propagating into downstream formatting.
    return 0.5;
  }
  return 1 / (1 + Math.exp(-rawScore));
}

/**
 * Clamp a value to the closed interval [0, 1]. NaN maps to 0 for safety.
 */
export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
