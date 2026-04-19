'use client'

import { useEffect, useState } from 'react'
import { RunSetupPanel } from '../components/analysis/RunSetupPanel'
import { LiveProgressPanel } from '../components/analysis/LiveProgressPanel'
import { ArtifactsPanel } from '../components/analysis/ArtifactsPanel'
import { FinalReportPanel } from '../components/analysis/FinalReportPanel'
import { HumanApprovalRail } from '../components/analysis/HumanApprovalRail'
import { TimelinePanel } from '../components/analysis/TimelinePanel'
import { useAnalysisRun } from '../hooks/useAnalysisRun'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { analysisRunsApi, type AnalysisRunResponse } from '../api/analysis-runs'

function getInitialRunId(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('runId')
}

export default function AnalysisPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(getInitialRunId)
  const [recentRuns, setRecentRuns] = useState<AnalysisRunResponse[]>([])
  const {
    run,
    stages,
    artifacts,
    timelineEvents,
    streamStatus,
    refresh,
    retryStage,
  } = useAnalysisRun(activeRunId)

  useEffect(() => {
    portfolioApi.list().then(setPortfolios).catch(() => setPortfolios([]))
    analysisRunsApi.list().then(setRecentRuns).catch(() => setRecentRuns([]))
  }, [])

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-4">
        <RunSetupPanel
          portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
          onRunCreated={(id) => {
            setActiveRunId(id)
            analysisRunsApi.list().then(setRecentRuns).catch(() => {})
          }}
        />

        {activeRunId ? (
          <>
            <LiveProgressPanel
              run={run}
              stages={stages}
              onRefresh={refresh}
              onRetryStage={retryStage}
            />
            <TimelinePanel
              events={timelineEvents}
              streamStatus={streamStatus}
              onRefresh={refresh}
            />
            <ArtifactsPanel artifacts={artifacts} />
            <FinalReportPanel run={run} artifacts={artifacts} />
          </>
        ) : (
          <section className="surface-panel rounded p-4">
            <h2 className="text-base font-semibold">Recent Runs</h2>
            <ul className="mt-2 space-y-1">
              {recentRuns.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <button
                    className="text-left text-sm underline text-slate-300"
                    onClick={() => setActiveRunId(r.id)}
                  >
                    {r.id.slice(0, 8)} · {r.status} · {r.sourceMode} · {new Date(r.createdAt).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <HumanApprovalRail run={run} onResolved={() => refresh()} />
    </div>
  )
}
