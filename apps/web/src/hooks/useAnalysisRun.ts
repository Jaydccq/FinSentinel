'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  analysisRunsApi,
  type AnalysisArtifactResponse,
  type AnalysisRunResponse,
  type AnalysisStageResponse,
} from '../api/analysis-runs'

const POLL_INTERVAL_MS = 2_000
const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING', 'WAITING_APPROVAL'])

export interface UseAnalysisRunResult {
  run: AnalysisRunResponse | null
  stages: AnalysisStageResponse[]
  artifacts: AnalysisArtifactResponse[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useAnalysisRun(runId: string | null): UseAnalysisRunResult {
  const [run, setRun] = useState<AnalysisRunResponse | null>(null)
  const [stages, setStages] = useState<AnalysisStageResponse[]>([])
  const [artifacts, setArtifacts] = useState<AnalysisArtifactResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAll = useCallback(async (): Promise<AnalysisRunResponse | null> => {
    if (!runId) return null
    try {
      setLoading(true)
      const [r, s, a] = await Promise.all([
        analysisRunsApi.getOne(runId),
        analysisRunsApi.listStages(runId),
        analysisRunsApi.listArtifacts(runId),
      ])
      setRun(r)
      setStages(s)
      setArtifacts(a)
      setError(null)
      return r
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
      return null
    } finally {
      setLoading(false)
    }
  }, [runId])

  const refresh = useCallback(async () => {
    await fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const tick = async () => {
      const latest = await fetchAll()
      if (cancelled) return
      if (latest && !ACTIVE_STATUSES.has(latest.status)) {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    tick()
    timerRef.current = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [runId, fetchAll])

  return { run, stages, artifacts, loading, error, refresh }
}
