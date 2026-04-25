'use client';

import { useState } from 'react';
import type { AnalysisArtifactResponse } from '../../api/analysis-runs';
import { ArtifactRenderer } from './ArtifactRenderer';

export interface ArtifactsPanelProps {
  artifacts: AnalysisArtifactResponse[];
}

export function ArtifactsPanel({ artifacts }: ArtifactsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (artifacts.length === 0) {
    return (
      <section className="surface-panel rounded p-4">
        <h2 className="text-base font-semibold">Artifacts</h2>
        <p className="text-sm text-slate-400 mt-2">No artifacts yet.</p>
      </section>
    );
  }
  return (
    <section className="surface-panel rounded p-4 space-y-2">
      <h2 className="text-base font-semibold">Artifacts</h2>
      <ul className="space-y-2">
        {artifacts.map((a) => {
          const isOpen = a.id === expandedId;
          return (
            <li key={a.id} className="rounded border border-slate-700 bg-slate-900/40">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left"
                onClick={() => setExpandedId(isOpen ? null : a.id)}
              >
                <span className="text-sm">
                  <code className="text-slate-300">{a.artifactKind}</code>
                  <span className="text-slate-500"> · {a.artifactName}</span>
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(a.createdAt).toLocaleTimeString()}
                </span>
              </button>
              {isOpen && (
                <div className="p-3">
                  <ArtifactRenderer artifact={a} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
