/**
 * PL-7 freshness logger shim.
 *
 * The web app does not yet have a structured observability module; this
 * thin wrapper exists so a future observability rollout can replace it
 * in one place. Output schema is intentionally minimal:
 *   { event: 'freshness.render', surface, state, ageMs }.
 */
import type { FreshnessState } from './freshness-state';
import type { FreshnessSurface } from './freshness-config';

export interface FreshnessLogEvent {
  surface: FreshnessSurface;
  state: FreshnessState;
  ageMs: number | null;
}

export function logFreshnessRender(event: FreshnessLogEvent): void {
  // console.info keeps this visible in browser devtools and harmless in SSR.
  console.info('freshness.render', event);
}
