'use client'

import { useEffect, useState } from 'react'
import { analysisRunsApi, type AnalysisRunResponse } from '../../api/analysis-runs'
import { analysisApprovalsApi } from '../../api/analysis-approvals'

interface ApprovalRow {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  requestedPayload: Record<string, unknown>
  requestedAt: string
}

export interface HumanApprovalRailProps {
  run: AnalysisRunResponse | null
  onResolved: () => void
}

export function HumanApprovalRail({ run, onResolved }: HumanApprovalRailProps) {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!run) return
    if (run.status !== 'WAITING_APPROVAL') {
      setApprovals([])
      return
    }
    let cancelled = false
    analysisRunsApi.listApprovals(run.id).then((rows) => {
      if (!cancelled) setApprovals(rows as ApprovalRow[])
    })
    return () => { cancelled = true }
  }, [run])

  if (!run || run.status !== 'WAITING_APPROVAL') return null
  const pending = approvals.find((a) => a.status === 'PENDING')
  if (!pending) return null

  const resolve = async (decision: 'APPROVE' | 'REJECT') => {
    setBusy(true)
    try {
      await analysisApprovalsApi.resolve(pending.id, decision, note || undefined)
      onResolved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="surface-panel rounded p-4 sticky top-4 space-y-3">
      <h2 className="text-base font-semibold">Human Approval</h2>
      <p className="text-xs text-slate-400">Run is paused. Review the order drafts below.</p>
      <pre className="text-xs bg-slate-950/70 p-2 rounded overflow-auto max-h-[200px]">
        {JSON.stringify(pending.requestedPayload, null, 2)}
      </pre>
      <label className="block">
        <span className="field-label">Note (optional)</span>
        <textarea
          rows={2}
          className="field-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          className="btn-primary px-4 py-2 text-sm flex-1"
          disabled={busy}
          onClick={() => resolve('APPROVE')}
        >
          Approve Execution
        </button>
        <button
          className="btn-secondary px-4 py-2 text-sm flex-1"
          disabled={busy}
          onClick={() => resolve('REJECT')}
        >
          Reject
        </button>
      </div>
    </aside>
  )
}
