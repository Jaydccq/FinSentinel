'use client'

import { useEffect, useState } from 'react'
import { RunSetupPanel } from '../components/analysis/RunSetupPanel'
import { LiveProgressPanel } from '../components/analysis/LiveProgressPanel'
import { ArtifactsPanel } from '../components/analysis/ArtifactsPanel'
import { FinalReportPanel } from '../components/analysis/FinalReportPanel'
import { HumanApprovalRail } from '../components/analysis/HumanApprovalRail'
import { TimelinePanel } from '../components/analysis/TimelinePanel'
import { ContextPanel } from '../components/analysis/ContextPanel'
import { RunNavigator } from '../components/analysis/RunNavigator'
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
    context,
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
    <div className="px-4 py-4 md:px-8 md:py-6 grid grid-cols-1 2xl:grid-cols-[260px_1fr_320px] gap-4">
      <RunNavigator
        recentRuns={recentRuns}
        activeRunId={activeRunId}
        onSelect={setActiveRunId}
      />
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
            <ContextPanel context={context} />
            <ArtifactsPanel artifacts={artifacts} />
            <FinalReportPanel run={run} artifacts={artifacts} />
          </>
        ) : null}
      </div>
      <HumanApprovalRail run={run} onResolved={() => refresh()} />
    </div>
  )
}
