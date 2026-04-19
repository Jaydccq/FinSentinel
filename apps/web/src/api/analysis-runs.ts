import {
  strategyArchivePayloadSchema,
  type StrategyArchivePayload as SharedStrategyArchivePayload,
} from '@finsentinel/shared';

import { BASE, authHeaders } from './client';

export type AnalysisStageKey =
  | 'INTELLIGENCE'
  | 'THESIS'
  | 'RISK'
  | 'EXECUTION_PREP'
  | 'HUMAN_APPROVAL';

export interface CreateRunRequest {
  prompt: string;
  sourceMode: 'CHAT' | 'WORKSPACE' | 'SCHEDULE' | 'HEARTBEAT';
  ticker?: string;
  portfolioId?: string;
  parentChatSessionId?: string;
  enabledTeams?: AnalysisStageKey[];
  researchDepth?: 'SHALLOW' | 'STANDARD' | 'DEEP';
}

export interface AnalysisRunResponse {
  id: string;
  userId: string;
  sourceMode: string;
  status:
    | 'QUEUED'
    | 'RUNNING'
    | 'WAITING_APPROVAL'
    | 'PAUSED'
    | 'FAILED'
    | 'COMPLETED'
    | 'CANCELED';
  currentStageKey: string | null;
  complexityScore: number | null;
  upgradeReason: string | null;
  parentChatSessionId: string | null;
  inputSnapshotJson: Record<string, unknown>;
  sharedContextJson: Record<string, unknown> | null;
  decisionObjectJson: AnalysisDecisionObjectJson | null;
  finalReportMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

export type StrategyArchivePayload = SharedStrategyArchivePayload;

export interface StrategyArchiveSnapshotFallback {
  snapshot: Record<string, unknown>;
}

export interface AnalysisDecisionObjectJson extends Record<string, unknown> {
  executionPayload?: Record<string, unknown>;
  strategyArchivePayload?: StrategyArchivePayload | StrategyArchiveSnapshotFallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isStrategyArchivePayload(
  value: unknown,
): value is StrategyArchivePayload {
  return strategyArchivePayloadSchema.safeParse(value).success;
}

function isLegacyStrategyArchiveSnapshotFallback(
  value: unknown,
): value is StrategyArchiveSnapshotFallback {
  return isRecord(value) && isRecord(value.snapshot);
}

export function sanitizeDecisionObjectJsonForDisplay(
  value: AnalysisDecisionObjectJson | null,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (!isLegacyStrategyArchiveSnapshotFallback(value.strategyArchivePayload)) {
    return value;
  }

  return {
    ...value,
    strategyArchivePayload: '[redacted legacy snapshot]',
  };
}

export interface AnalysisStageResponse {
  id: string;
  runId: string;
  stageKey: AnalysisStageKey;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  checkpointVersion: number;
  humanReportMarkdown: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AnalysisArtifactResponse {
  id: string;
  runId: string;
  stageId: string | null;
  artifactKind: string;
  artifactName: string;
  mimeType: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AnalysisApprovalResponse {
  id: string;
  runId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  requestedPayload: Record<string, unknown>;
  requestedAt: string;
}

export interface AnalysisRunTimelineEvent {
  id: string;
  seqNo: number | null;
  aggregateType: string;
  aggregateId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AnalysisRunStreamOptions {
  afterSeqNo?: number | null;
  onEvent: (event: AnalysisRunTimelineEvent) => void;
  onError?: (error: Error) => void;
}

export interface AnalysisRunStreamHandle {
  abort: () => void;
  closed: Promise<void>;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function parseSseBlock(block: string): AnalysisRunTimelineEvent | null {
  const dataLines: string[] = [];
  let eventType: string | null = null;

  for (const line of block.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue;
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') eventType = value;
    if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  const parsed = JSON.parse(dataLines.join('\n')) as AnalysisRunTimelineEvent;
  return eventType && !parsed.eventType ? { ...parsed, eventType } : parsed;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function streamRun(
  id: string,
  { afterSeqNo, onEvent, onError }: AnalysisRunStreamOptions,
): AnalysisRunStreamHandle {
  const controller = new AbortController();
  const params = new URLSearchParams();
  if (afterSeqNo != null) params.set('afterSeqNo', String(afterSeqNo));
  const query = params.toString();
  const path = `/analysis/runs/${id}/stream${query ? `?${query}` : ''}`;

  const closed = (async () => {
    try {
      const res = await fetch(`${BASE}${path}`, {
        credentials: 'include',
        headers: authHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      if (!res.body) throw new Error(`GET ${path} did not return a stream`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let delimiterIndex = buffer.search(/\r?\n\r?\n/);
        while (delimiterIndex !== -1) {
          const block = buffer.slice(0, delimiterIndex);
          const delimiter = buffer.match(/\r?\n\r?\n/)?.[0] ?? '\n\n';
          buffer = buffer.slice(delimiterIndex + delimiter.length);
          const event = parseSseBlock(block);
          if (event) onEvent(event);
          delimiterIndex = buffer.search(/\r?\n\r?\n/);
        }
      }

      buffer += decoder.decode();
      const trailing = buffer.trim();
      if (trailing) {
        const event = parseSseBlock(trailing);
        if (event) onEvent(event);
      }
    } catch (error) {
      if (isAbortError(error)) return;
      const err = error instanceof Error ? error : new Error(String(error));
      onError?.(err);
      throw err;
    }
  })();

  return {
    abort: () => controller.abort(),
    closed,
  };
}

export const analysisRunsApi = {
  create: (req: CreateRunRequest) =>
    json<AnalysisRunResponse>('/analysis/runs', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  list: () => json<AnalysisRunResponse[]>('/analysis/runs'),
  getOne: (id: string) => json<AnalysisRunResponse>(`/analysis/runs/${id}`),
  listStages: (id: string) =>
    json<AnalysisStageResponse[]>(`/analysis/runs/${id}/stages`),
  listArtifacts: (id: string) =>
    json<AnalysisArtifactResponse[]>(`/analysis/runs/${id}/artifacts`),
  listApprovals: (id: string) =>
    json<AnalysisApprovalResponse[]>(`/analysis/runs/${id}/approvals`),
  pause: (id: string) => json<{ ok: true }>(`/analysis/runs/${id}/pause`, { method: 'POST' }),
  resume: (id: string) =>
    json<{ ok: true }>(`/analysis/runs/${id}/resume`, { method: 'POST' }),
  cancel: (id: string) =>
    json<{ ok: true }>(`/analysis/runs/${id}/cancel`, { method: 'POST' }),
  retryStage: (id: string, stageKey: AnalysisStageKey) =>
    json<{ ok: true }>(`/analysis/runs/${id}/stages/${stageKey}/retry`, {
      method: 'POST',
    }),
  stream: streamRun,
};
