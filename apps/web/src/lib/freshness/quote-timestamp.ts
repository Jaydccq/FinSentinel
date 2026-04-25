/**
 * PL-7 quote-timestamp adapter.
 *
 * Background: the API's `marketQuoteSchema.timestamp` is a number, but the
 * provider implementations disagree on units —
 *   - Yahoo (`apps/api/src/market/providers/yahoo.provider.ts:114`) emits ms.
 *   - Polygon (`apps/api/src/market/providers/polygon.provider.ts:66`) emits ms.
 *   - FMP (`apps/api/src/market/providers/fmp.provider.ts:90`) passes the
 *     upstream `quote.timestamp` through unchanged — FMP's REST emits seconds.
 *
 * Normalizing in providers is the right long-term fix, but it is a backend
 * change out of scope for PL-7 phase 1. Until then we coerce defensively
 * here, in one place: any value below 1e12 is interpreted as seconds. The
 * earliest plausible ms value (~1e12 = 2001) is well above any seconds
 * timestamp from the present era (~1.7e9), so the heuristic is unambiguous.
 */
export function normalizeQuoteTimestampMs(
  ts: number | null | undefined,
): number | null {
  if (ts === null || ts === undefined) return null;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return ts < 1e12 ? ts * 1000 : ts;
}
