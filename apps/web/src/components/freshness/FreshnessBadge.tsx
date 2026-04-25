'use client';

/**
 * PL-7 FreshnessBadge — read-only data-freshness indicator.
 *
 * One badge per consuming surface. Reads its "now" from useFreshnessNow()
 * so all badges in a page tick together and freeze together when the tab
 * is hidden. Emits one structured log event per render via the freshness
 * logger shim.
 */
import { useEffect } from 'react';
import { useFreshnessNow } from '../../lib/freshness/use-freshness-now';
import { computeFreshnessState } from '../../lib/freshness/freshness-state';
import type { FreshnessSurface } from '../../lib/freshness/freshness-config';
import { logFreshnessRender } from '../../lib/freshness/freshness-logger';

interface FreshnessBadgeProps {
  surface: FreshnessSurface;
  sourceTimestampMs: number | null | undefined;
  className?: string;
}

function buildTooltip(
  sourceTimestampMs: number | null | undefined,
  label: string,
): string {
  if (
    sourceTimestampMs === null ||
    sourceTimestampMs === undefined ||
    Number.isNaN(sourceTimestampMs)
  ) {
    return label;
  }
  return `${label} — source: ${new Date(sourceTimestampMs).toISOString()}`;
}

export function FreshnessBadge({
  surface,
  sourceTimestampMs,
  className,
}: FreshnessBadgeProps) {
  const nowMs = useFreshnessNow();
  const result = computeFreshnessState({ sourceTimestampMs, nowMs, surface });

  useEffect(() => {
    logFreshnessRender({
      surface: result.surface,
      state: result.state,
      ageMs: result.ageMs,
    });
  });

  const baseClass =
    'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none';
  const fullClass = [baseClass, result.colorClass, className]
    .filter(Boolean)
    .join(' ');

  // TODO i18n — labels are English-only for v1.
  return (
    <span
      role="status"
      tabIndex={0}
      aria-label={result.label}
      title={buildTooltip(sourceTimestampMs, result.label)}
      className={fullClass}
      data-freshness-state={result.state}
      data-freshness-surface={surface}
    >
      {result.label}
    </span>
  );
}

export default FreshnessBadge;
