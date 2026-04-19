'use client'

import type { AnalysisRunTimelineEvent } from '../../api/analysis-runs'
import type { AnalysisRunStreamStatus } from '../../hooks/useAnalysisRun'

export interface TimelinePanelProps {
  events: AnalysisRunTimelineEvent[]
  streamStatus: AnalysisRunStreamStatus
  onRefresh: () => void
}

const STREAM_LABEL: Record<AnalysisRunStreamStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  live: 'Live',
  fallback: 'Polling fallback',
  closed: 'Closed',
}

const STREAM_STYLE: Record<AnalysisRunStreamStatus, string> = {
  idle: 'border-slate-700 bg-slate-800 text-slate-300',
  connecting: 'border-blue-300/40 bg-blue-500/20 text-blue-100',
  live: 'border-green-300/40 bg-green-500/20 text-green-100',
  fallback: 'border-yellow-300/40 bg-yellow-500/20 text-yellow-100',
  closed: 'border-slate-600 bg-slate-800 text-slate-300',
}

function getPayloadSummary(payload: Record<string, unknown>): string {
  const stageKey = typeof payload.stageKey === 'string' ? payload.stageKey : null
  const roleKey = typeof payload.roleKey === 'string' ? payload.roleKey : null
  const status = typeof payload.status === 'string' ? payload.status : null
  const retry = payload.retry === true ? 'retry' : null
  const summary = [stageKey, roleKey, status, retry].filter(Boolean).join(' · ')
  if (summary) return summary
  const keys = Object.keys(payload)
  return keys.length > 0 ? keys.slice(0, 4).join(', ') : 'No payload'
}

export function TimelinePanel({ events, streamStatus, onRefresh }: TimelinePanelProps) {
  const recentEvents = [...events].reverse().slice(0, 20)

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold">Operator Timeline</h2>
          <p className="text-xs text-slate-400">
            {events.length} events captured from run stream
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`status-chip border ${STREAM_STYLE[streamStatus]}`}>
            {STREAM_LABEL[streamStatus]}
          </span>
          <button className="btn-secondary px-3 py-1 text-xs" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </header>

      {recentEvents.length === 0 ? (
        <p className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-400">
          Waiting for run events.
        </p>
      ) : (
        <ol className="space-y-2">
          {recentEvents.map((event) => (
            <li
              key={event.seqNo == null ? event.id : event.seqNo}
              className="rounded border border-slate-700 bg-slate-900/40 px-3 py-2"
            >
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <span className="break-words font-mono text-sm text-slate-100">
                  {event.eventType}
                </span>
                <span className="text-xs text-slate-500">
                  {event.seqNo == null ? 'seq -' : `seq ${event.seqNo}`} ·{' '}
                  {new Date(event.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="mt-1 break-words text-xs text-slate-400">
                {getPayloadSummary(event.payload)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
