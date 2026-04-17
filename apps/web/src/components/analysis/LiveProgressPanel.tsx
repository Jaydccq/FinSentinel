'use client'

import type {
  AnalysisRunResponse,
  AnalysisStageResponse,
} from '../../api/analysis-runs'
import { analysisRunsApi } from '../../api/analysis-runs'

const TEAM_ORDER = [
  'INTELLIGENCE',
  'THESIS',
  'RISK',
  'EXECUTION_PREP',
  'HUMAN_APPROVAL',
] as const

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-slate-800 text-slate-400 border-slate-700',
  RUNNING: 'bg-blue-500/25 text-blue-100 border-blue-300/40 animate-pulse',
  COMPLETED: 'bg-green-500/20 text-green-200 border-green-300/40',
  FAILED: 'bg-red-500/20 text-red-200 border-red-300/40',
  SKIPPED: 'bg-slate-700 text-slate-300 border-slate-600',
}

export interface LiveProgressPanelProps {
  run: AnalysisRunResponse | null
  stages: AnalysisStageResponse[]
  onRefresh: () => void
}

export function LiveProgressPanel({ run, stages, onRefresh }: LiveProgressPanelProps) {
  if (!run) return null
  const stageByKey = new Map(stages.map((s) => [s.stageKey, s] as const))

  const pause = async () => { await analysisRunsApi.pause(run.id); onRefresh() }
  const resume = async () => { await analysisRunsApi.resume(run.id); onRefresh() }
  const cancel = async () => { await analysisRunsApi.cancel(run.id); onRefresh() }

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
            <button className="btn-secondary px-3 py-1 text-xs" onClick={pause}>Pause</button>
          )}
          {run.status === 'PAUSED' && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={resume}>Resume</button>
          )}
          {(run.status === 'RUNNING' || run.status === 'PAUSED' || run.status === 'WAITING_APPROVAL') && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={cancel}>Cancel</button>
          )}
        </div>
      </header>

      <ol className="space-y-2">
        {TEAM_ORDER.map((key) => {
          const stage = stageByKey.get(key)
          const status = stage?.status ?? 'PENDING'
          return (
            <li key={key} className="flex items-center justify-between rounded border border-slate-700 bg-slate-900/40 px-3 py-2">
              <span className="font-mono text-sm">{key}</span>
              <span className={`status-chip border ${STATUS_STYLE[status] ?? STATUS_STYLE.PENDING}`}>
                {status}
                {stage?.checkpointVersion ? ` · v${stage.checkpointVersion}` : ''}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
