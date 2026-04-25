'use client';

import { useState } from 'react';
import type {
  AnalysisStageKey,
  AnalysisRunResponse,
  AnalysisStageResponse,
} from '../../api/analysis-runs';
import { analysisRunsApi } from '../../api/analysis-runs';

const TEAM_ORDER = ['INTELLIGENCE', 'THESIS', 'RISK', 'EXECUTION_PREP', 'HUMAN_APPROVAL'] as const;

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-slate-800 text-slate-400 border-slate-700',
  RUNNING: 'bg-blue-500/25 text-blue-100 border-blue-300/40 animate-pulse',
  COMPLETED: 'bg-green-500/20 text-green-200 border-green-300/40',
  FAILED: 'bg-red-500/20 text-red-200 border-red-300/40',
  SKIPPED: 'bg-slate-700 text-slate-300 border-slate-600',
};

export interface LiveProgressPanelProps {
  run: AnalysisRunResponse | null;
  stages: AnalysisStageResponse[];
  onRefresh: () => void;
  onRetryStage?: (stageKey: AnalysisStageKey) => Promise<void>;
}

export function LiveProgressPanel({
  run,
  stages,
  onRefresh,
  onRetryStage,
}: LiveProgressPanelProps) {
  const [retryingStage, setRetryingStage] = useState<AnalysisStageKey | null>(null);
  if (!run) return null;
  const stageByKey = new Map(stages.map((s) => [s.stageKey, s] as const));
  const canRetryRun = ['FAILED', 'PAUSED', 'WAITING_APPROVAL'].includes(run.status);

  const pause = async () => {
    await analysisRunsApi.pause(run.id);
    onRefresh();
  };
  const resume = async () => {
    await analysisRunsApi.resume(run.id);
    onRefresh();
  };
  const cancel = async () => {
    await analysisRunsApi.cancel(run.id);
    onRefresh();
  };
  const retry = async (stageKey: AnalysisStageKey) => {
    if (!onRetryStage) return;
    setRetryingStage(stageKey);
    try {
      await onRetryStage(stageKey);
    } finally {
      setRetryingStage(null);
    }
  };

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Live Progress</h2>
          <p className="text-xs text-slate-400">
            Run {run.id.slice(0, 8)} · status <b>{run.status}</b>
            {run.upgradeReason ? ` · via ${run.upgradeReason}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {run.status === 'RUNNING' && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={pause}>
              Pause
            </button>
          )}
          {run.status === 'PAUSED' && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={resume}>
              Resume
            </button>
          )}
          {(run.status === 'RUNNING' ||
            run.status === 'PAUSED' ||
            run.status === 'WAITING_APPROVAL') && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </header>

      <ol className="space-y-2">
        {TEAM_ORDER.map((key) => {
          const stage = stageByKey.get(key);
          const status = stage?.status ?? 'PENDING';
          const canRetryStage = Boolean(
            onRetryStage && stage && canRetryRun && status !== 'PENDING',
          );
          return (
            <li key={key} className="rounded border border-slate-700 bg-slate-900/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{key}</span>
                <div className="flex items-center gap-2">
                  {canRetryStage && (
                    <button
                      className="btn-secondary px-2 py-1 text-xs"
                      disabled={retryingStage !== null}
                      onClick={() => retry(key)}
                    >
                      {retryingStage === key ? 'Retrying' : 'Retry'}
                    </button>
                  )}
                  <span
                    className={`status-chip border ${STATUS_STYLE[status] ?? STATUS_STYLE.PENDING}`}
                  >
                    {status}
                    {stage?.checkpointVersion ? ` · v${stage.checkpointVersion}` : ''}
                  </span>
                </div>
              </div>
              {stage?.structuredOutput?.roleSummaries?.length ? (
                <ul className="mt-2 w-full space-y-1 pl-2 border-l border-slate-700">
                  {stage.structuredOutput.roleSummaries.map((role) => (
                    <li key={role.roleKey} className="text-xs text-slate-400">
                      {role.roleKey} · {role.status} ·{' '}
                      {Math.max(1, Math.round(role.durationMs / 1000))}s · {role.toolCallCount}{' '}
                      tools
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
