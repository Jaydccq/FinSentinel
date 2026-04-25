'use client';

import type { AnalysisRunResponse } from '../../api/analysis-runs';

export interface RunNavigatorProps {
  recentRuns: AnalysisRunResponse[];
  activeRunId: string | null;
  onSelect: (id: string) => void;
}

export function RunNavigator({ recentRuns, activeRunId, onSelect }: RunNavigatorProps) {
  return (
    <aside className="surface-panel rounded p-3 space-y-2">
      <h2 className="text-sm font-semibold">Recent Runs</h2>
      {recentRuns.length === 0 ? (
        <p className="text-xs text-slate-500">No runs yet.</p>
      ) : (
        <ul className="space-y-1">
          {recentRuns.map((run) => {
            const active = run.id === activeRunId;
            return (
              <li key={run.id}>
                <button
                  className={`w-full text-left rounded px-2 py-1 text-xs font-mono ${active ? 'bg-slate-700 text-slate-100' : 'text-slate-300 hover:bg-slate-800'}`}
                  onClick={() => onSelect(run.id)}
                >
                  {run.id.slice(0, 8)} · {run.sourceMode} · {run.status}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
