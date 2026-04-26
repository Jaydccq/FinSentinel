'use client';

/**
 * PL-7 phase 2 — CitationsPanel.
 *
 * Lists citations grouped by stage with a freshness badge per row.
 * - Always renders the badge: missing publishedAt → Unknown badge.
 * - No de-duplication across stages in v1.
 * - Empty state when every stage's citations array is empty.
 */
import type { AnalysisStageResponse } from '../../api/analysis-runs';
import type { Citation } from '@finsentinel/shared';
import { FreshnessBadge } from '../freshness/FreshnessBadge';

interface CitationsPanelProps {
  stages: AnalysisStageResponse[];
}

export function CitationsPanel({ stages }: CitationsPanelProps) {
  const stagesWithCitations = stages
    .map((s) => ({
      stageKey: s.stageKey,
      stageId: s.id,
      citations: ((s.structuredOutput?.citations as Citation[] | undefined) ?? []),
    }))
    .filter((g) => g.citations.length > 0);

  if (stagesWithCitations.length === 0) {
    return (
      <section
        aria-labelledby="citations-panel-heading"
        className="rounded border border-gray-200 p-4"
      >
        <h2 id="citations-panel-heading" className="text-sm font-semibold mb-2">
          Citations
        </h2>
        <p className="text-xs italic text-gray-500">
          No citations yet — citations appear once stages complete.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="citations-panel-heading"
      className="rounded border border-gray-200 p-4 space-y-3"
    >
      <h2 id="citations-panel-heading" className="text-sm font-semibold">
        Citations
      </h2>
      {stagesWithCitations.map((g) => (
        <div key={g.stageId} className="space-y-2">
          <h3 className="text-xs font-medium uppercase text-gray-500">{g.stageKey}</h3>
          <ul className="space-y-2">
            {g.citations.map((c, i) => (
              <li
                key={`${g.stageId}-${i}`}
                className="flex items-start gap-2 rounded bg-gray-50 px-3 py-2"
              >
                <FreshnessBadge
                  surface="citation"
                  sourceTimestampMs={c.publishedAt ? Date.parse(c.publishedAt) : null}
                />
                <div className="flex-1 text-sm">
                  <div className="font-medium">
                    {c.title ?? c.url ?? c.artifactId ?? 'Untitled'}
                  </div>
                  {c.url ? (
                    <a
                      className="text-xs text-blue-700 hover:underline"
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {c.url}
                    </a>
                  ) : null}
                  {c.excerpt ? (
                    <div className="mt-1 text-xs text-gray-700">{c.excerpt}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default CitationsPanel;
