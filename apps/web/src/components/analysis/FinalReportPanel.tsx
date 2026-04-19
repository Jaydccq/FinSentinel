'use client'

import type {
  AnalysisArtifactResponse,
  AnalysisRunResponse,
} from '../../api/analysis-runs'

export interface FinalReportPanelProps {
  run: AnalysisRunResponse | null
  artifacts: AnalysisArtifactResponse[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function FinalReportPanel({ run, artifacts }: FinalReportPanelProps) {
  if (!run || (run.status !== 'COMPLETED' && run.status !== 'WAITING_APPROVAL')) {
    return null
  }

  const executionPayload = artifacts.find((a) => a.artifactKind === 'EXECUTION_PAYLOAD')
  const orderDrafts = artifacts.find((a) => a.artifactKind === 'ORDER_DRAFTS')
  const materializedExecutionPayload = asRecord(run.decisionObjectJson?.executionPayload)

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <h2 className="text-base font-semibold">Final Report</h2>
      {run.finalReportMarkdown && (
        <pre className="whitespace-pre-wrap text-sm">{run.finalReportMarkdown}</pre>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div>
          <h3 className="text-sm font-semibold">Decision Object</h3>
          <pre className="text-xs bg-slate-950/70 p-2 rounded overflow-auto">
            {JSON.stringify(run.decisionObjectJson ?? null, null, 2)}
          </pre>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Execution Payload</h3>
          <pre className="text-xs bg-slate-950/70 p-2 rounded overflow-auto">
            {JSON.stringify(
              materializedExecutionPayload ?? executionPayload?.payload ?? orderDrafts?.payload ?? null,
              null,
              2,
            )}
          </pre>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Shared Context</h3>
          <pre className="text-xs bg-slate-950/70 p-2 rounded overflow-auto">
            {JSON.stringify(run.sharedContextJson ?? null, null, 2)}
          </pre>
        </div>
      </div>
    </section>
  )
}
