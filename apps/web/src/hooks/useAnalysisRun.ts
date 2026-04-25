'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  analysisRunsApi,
  type AnalysisArtifactResponse,
  type AnalysisRunResponse,
  type AnalysisStageResponse,
  type AnalysisRunTimelineEvent,
  type AnalysisStageKey,
  type RunContext,
} from '../api/analysis-runs';

const POLL_INTERVAL_MS = 2_000;
const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING', 'WAITING_APPROVAL']);
const TERMINAL_EVENTS = new Set(['RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELED']);

export type AnalysisRunStreamStatus = 'idle' | 'connecting' | 'live' | 'fallback' | 'closed';

export interface UseAnalysisRunResult {
  run: AnalysisRunResponse | null;
  stages: AnalysisStageResponse[];
  artifacts: AnalysisArtifactResponse[];
  context: RunContext | null;
  timelineEvents: AnalysisRunTimelineEvent[];
  streamStatus: AnalysisRunStreamStatus;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  retryStage: (stageKey: AnalysisStageKey) => Promise<void>;
}

export function useAnalysisRun(runId: string | null): UseAnalysisRunResult {
  const [run, setRun] = useState<AnalysisRunResponse | null>(null);
  const [stages, setStages] = useState<AnalysisStageResponse[]>([]);
  const [artifacts, setArtifacts] = useState<AnalysisArtifactResponse[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<AnalysisRunTimelineEvent[]>([]);
  const [context, setContext] = useState<RunContext | null>(null);
  const [streamStatus, setStreamStatus] = useState<AnalysisRunStreamStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeqNoRef = useRef<number | null>(null);
  const seenEventKeysRef = useRef<Set<string>>(new Set());

  const appendTimelineEvent = useCallback((event: AnalysisRunTimelineEvent) => {
    const key = event.seqNo == null ? event.id : String(event.seqNo);
    if (seenEventKeysRef.current.has(key)) return;
    seenEventKeysRef.current.add(key);
    if (event.seqNo != null) {
      lastSeqNoRef.current = Math.max(lastSeqNoRef.current ?? event.seqNo, event.seqNo);
    }
    setTimelineEvents((current) => [...current, event].slice(-100));
  }, []);

  const fetchAll = useCallback(async (): Promise<AnalysisRunResponse | null> => {
    if (!runId) return null;
    try {
      setLoading(true);
      const [r, s, a] = await Promise.all([
        analysisRunsApi.getOne(runId),
        analysisRunsApi.listStages(runId),
        analysisRunsApi.listArtifacts(runId),
      ]);
      setRun(r);
      setStages(s);
      setArtifacts(a);
      setError(null);
      return r;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const refresh = useCallback(async () => {
    await fetchAll();
  }, [fetchAll]);

  const retryStage = useCallback(
    async (stageKey: AnalysisStageKey) => {
      if (!runId) return;
      await analysisRunsApi.retryStage(runId, stageKey);
      await fetchAll();
    },
    [fetchAll, runId],
  );

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setStages([]);
      setArtifacts([]);
      setTimelineEvents([]);
      setStreamStatus('idle');
      lastSeqNoRef.current = null;
      seenEventKeysRef.current.clear();
      return;
    }

    let cancelled = false;
    setTimelineEvents([]);
    setStreamStatus('connecting');
    lastSeqNoRef.current = null;
    seenEventKeysRef.current.clear();

    const handle = analysisRunsApi.stream(runId, {
      afterSeqNo: lastSeqNoRef.current,
      onEvent: (event) => {
        if (cancelled) return;
        appendTimelineEvent(event);
        setStreamStatus('live');
        void fetchAll();
        if (TERMINAL_EVENTS.has(event.eventType)) {
          setStreamStatus('closed');
          handle.abort();
        }
      },
      onError: (err) => {
        if (cancelled) return;
        setError(err.message);
        setStreamStatus('fallback');
      },
    });

    void handle.closed
      .then(() => {
        if (!cancelled) setStreamStatus((status) => (status === 'fallback' ? status : 'closed'));
      })
      .catch(() => {
        if (!cancelled) setStreamStatus('fallback');
      });

    return () => {
      cancelled = true;
      handle.abort();
    };
  }, [appendTimelineEvent, fetchAll, runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      const latest = await fetchAll();
      if (cancelled) return;
      if (latest && !ACTIVE_STATUSES.has(latest.status)) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    tick();
    timerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [runId, fetchAll]);

  useEffect(() => {
    if (!runId) {
      setContext(null);
      return;
    }
    let cancelled = false;
    analysisRunsApi
      .getContext(runId)
      .then((c) => {
        if (!cancelled) setContext(c);
      })
      .catch(() => {
        // Swallow — context is best-effort; failures don't block the UI.
      });
    return () => {
      cancelled = true;
    };
  }, [runId, run?.status]);

  return {
    run,
    stages,
    artifacts,
    context,
    timelineEvents,
    streamStatus,
    loading,
    error,
    refresh,
    retryStage,
  };
}
