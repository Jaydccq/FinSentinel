'use client'

import type {
  AnalysisArtifactResponse,
  AnalysisRunResponse,
} from '../../api/analysis-runs'

export interface FinalReportPanelProps {
  run: AnalysisRunResponse | null
  artifacts: AnalysisArtifactResponse[]
}

export function FinalReportPanel({ run, artifacts }: FinalReportPanelProps) {
  if (!run || (run.status !== 'COMPLETED' && run.status !== 'WAITING_APPROVAL')) {
    return null
  }

  const executionPayload = artifacts.find((a) => a.artifactKind === 'EXECUTION_PAYLOAD')
  const orderDrafts = artifacts.find((a) => a.artifactKind === 'ORDER_DRAFTS')
  const riskReport = artifacts.find(
    (a) => a.artifactKind === 'STAGE_STRUCTURED_OUTPUT' && a.artifactName.startsWith('risk-'),
  )

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <h2 className="text-base font-semibold">Final Report</h2>
      {run.finalReportMarkdown && (
        <pre className="whitespace-pre-wrap text-sm">{run.finalReportMarkdown}</pre>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <h3 className="text-sm font-semibold">Decision Object</h3>
          <pre className="text-xs bg-slate-950/70 p-2 rounded overflow-auto">
            {JSON.stringify(riskReport?.payload ?? null, null, 2)}
          </pre>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Execution Payload</h3>
          <pre className="text-xs bg-slate-950/70 p-2 rounded overflow-auto">
            {JSON.stringify(executionPayload?.payload ?? orderDrafts?.payload ?? null, null, 2)}
          </pre>
        </div>
      </div>
    </section>
  )
}
