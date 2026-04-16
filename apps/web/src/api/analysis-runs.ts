import { BASE, authHeaders } from './client';

export interface CreateRunRequest {
  prompt: string;
  sourceMode: 'CHAT' | 'WORKSPACE' | 'SCHEDULE' | 'HEARTBEAT';
  ticker?: string;
  portfolioId?: string;
  parentChatSessionId?: string;
  enabledTeams?: string[];
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
  finalReportMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AnalysisStageResponse {
  id: string;
  runId: string;
  stageKey: 'INTELLIGENCE' | 'THESIS' | 'RISK' | 'EXECUTION_PREP' | 'HUMAN_APPROVAL';
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

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
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
};
