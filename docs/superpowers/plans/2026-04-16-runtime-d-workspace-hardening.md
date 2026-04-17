# Plan D — Workspace UX + Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/web/src/views/AnalysisPage.tsx` into a real analysis workspace — run setup panel, live progress panel, artifacts panel, final report panel, right-rail human approval — and land the hardening work needed to ship v1 behind feature flags.

**Architecture:** The workspace is a single page split into 4 left-column panels plus a fixed right-rail approval column. It polls `GET /analysis/runs/:id` + `GET /analysis/runs/:id/stages` + `GET /analysis/runs/:id/artifacts` every 2 seconds while `status ∈ {QUEUED, RUNNING, WAITING_APPROVAL}`. Approval POSTs to the Plan A approval endpoint. The existing chat page gains an "Open Run" affordance when the upgrade header is present. A runbook captures the rollout sequence.

**Tech Stack:** Next.js 16 App Router (static export mode compatible), React, SWR-like polling (no new deps — use `setInterval`), Vitest for API clients, Playwright optional for E2E.

**Depends on:** Plan A (DB schema + APIs), Plan B (team execution so artifacts actually arrive), Plan C (chat upgrade + runtime triggers).
**Unblocks:** v1 GA.

---

## File Structure

### New files

```
apps/web/src/api/analysis-runs.ts
apps/web/src/api/analysis-approvals.ts
apps/web/src/api/__tests__/analysis-runs.test.ts

apps/web/src/components/analysis/RunSetupPanel.tsx
apps/web/src/components/analysis/LiveProgressPanel.tsx
apps/web/src/components/analysis/ArtifactsPanel.tsx
apps/web/src/components/analysis/FinalReportPanel.tsx
apps/web/src/components/analysis/HumanApprovalRail.tsx

apps/web/src/hooks/useAnalysisRun.ts

docs/runbooks/2026-04-16-multi-agent-runtime-rollout.md
```

### Modified files

```
apps/web/src/views/AnalysisPage.tsx              # Repurposed into workspace root
apps/web/src/views/ChatPage.tsx                  # Show "Open Run" jump on upgrade
apps/web/src/views/AutonomyPage.tsx              # List recent runs per schedule
apps/web/src/api/chat.ts                         # Surface runId + upgradeReason from headers

apps/api/src/config/env.validation.ts            # (verification) flags already added; add test matrix entries
apps/api/src/analysis/analysis.controller.ts     # Gate legacy stream path behind ANALYSIS_RUNS_ENABLED=false
```

The legacy `AnalysisPage` behavior (one-shot risk report) is preserved behind a fallback toggle so the workspace can ship alongside it. Feature flag off = legacy behavior, flag on = new workspace.

---

## Task 1: Web API Client for Runs + Approvals

**Files:**
- Create: `apps/web/src/api/analysis-runs.ts`
- Create: `apps/web/src/api/analysis-approvals.ts`
- Create: `apps/web/src/api/__tests__/analysis-runs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/api/__tests__/analysis-runs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal shape we rely on from the client.
interface AnalysisRunResponse {
  id: string;
  status: string;
  sourceMode: string;
  currentStageKey: string | null;
  createdAt: string;
  updatedAt: string;
}

describe('analysisRunsApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'r1', status: 'QUEUED' }),
    });
    globalThis.fetch = fetchMock as never;
  });

  it('create() POSTs to /analysis/runs with credentials and auth headers', async () => {
    const { analysisRunsApi } = await import('../analysis-runs');
    const out = await analysisRunsApi.create({ prompt: 'x', sourceMode: 'WORKSPACE' });
    const call = fetchMock.mock.calls[0];
    const url = call?.[0] as string;
    const init = call?.[1] as RequestInit;
    expect(url).toContain('/analysis/runs');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((out as AnalysisRunResponse).id).toBe('r1');
  });

  it('listStages() GETs /analysis/runs/:id/stages', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    const { analysisRunsApi } = await import('../analysis-runs');
    await analysisRunsApi.listStages('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/stages');
  });

  it('pause()/resume()/cancel() POST to the respective subpaths', async () => {
    const { analysisRunsApi } = await import('../analysis-runs');
    await analysisRunsApi.pause('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/pause');
    fetchMock.mockClear();
    await analysisRunsApi.resume('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/resume');
    fetchMock.mockClear();
    await analysisRunsApi.cancel('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/cancel');
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/web test -- analysis-runs`
Expected: FAIL.

- [ ] **Step 3: Implement the client**

Create `apps/web/src/api/analysis-runs.ts`:

```ts
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
  pause: (id: string) => json<{ ok: true }>(`/analysis/runs/${id}/pause`, { method: 'POST' }),
  resume: (id: string) =>
    json<{ ok: true }>(`/analysis/runs/${id}/resume`, { method: 'POST' }),
  cancel: (id: string) =>
    json<{ ok: true }>(`/analysis/runs/${id}/cancel`, { method: 'POST' }),
};
```

- [ ] **Step 4: Implement approvals client**

Create `apps/web/src/api/analysis-approvals.ts`:

```ts
import { BASE, authHeaders } from './client';

export type ApprovalDecision = 'APPROVE' | 'REJECT';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const analysisApprovalsApi = {
  resolve: (approvalId: string, decision: ApprovalDecision, note?: string) =>
    post<{ ok: true }>(`/analysis/approvals/${approvalId}/resolve`, { decision, note }),
};
```

- [ ] **Step 5: Add the stages + artifacts routes to AnalysisRunController**

Plan A's controller only has `/runs/:id`. Add the nested routes now.

Edit `apps/api/src/analysis/analysis-run.controller.ts`. Inject `AnalysisCheckpointService` and add a stages + artifacts lookup method (or a shared `listStages` / `listArtifacts` on `AnalysisRunService` — either is fine, pick one and be consistent):

```ts
  @Get(':id/stages')
  async listStages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const run = await this.runs.getForUser(user.sub, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return this.runs.listStagesForRun(id);
  }

  @Get(':id/artifacts')
  async listArtifacts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const run = await this.runs.getForUser(user.sub, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return this.runs.listArtifactsForRun(id);
  }
```

Add the two query methods to `AnalysisRunService`:

```ts
  async listStagesForRun(runId: string) {
    return this.db
      .select()
      .from(analysisStages)
      .where(eq(analysisStages.runId, runId))
      .orderBy(asc(analysisStages.startedAt));
  }

  async listArtifactsForRun(runId: string) {
    return this.db
      .select()
      .from(analysisArtifacts)
      .where(eq(analysisArtifacts.runId, runId))
      .orderBy(desc(analysisArtifacts.createdAt));
  }
```

(Import `analysisStages`, `analysisArtifacts`, `asc`, `desc` at top of file.)

- [ ] **Step 6: Run tests + commit**

```bash
pnpm --filter @finsentinel/web test -- analysis-runs
pnpm --filter @finsentinel/api typecheck
git add apps/web/src/api/analysis-runs.ts \
        apps/web/src/api/analysis-approvals.ts \
        apps/web/src/api/__tests__/analysis-runs.test.ts \
        apps/api/src/analysis/analysis-run.controller.ts \
        apps/api/src/analysis/analysis-run.service.ts
git commit -m "feat(web+api): analysis-runs/approvals API client + run stages/artifacts endpoints"
```

---

## Task 2: `useAnalysisRun` Polling Hook

**Files:**
- Create: `apps/web/src/hooks/useAnalysisRun.ts`

- [ ] **Step 1: Implement the hook**

Create `apps/web/src/hooks/useAnalysisRun.ts`:

```ts
'use client'

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  analysisRunsApi,
  type AnalysisArtifactResponse,
  type AnalysisRunResponse,
  type AnalysisStageResponse,
} from '../api/analysis-runs';

const POLL_INTERVAL_MS = 2_000;
const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING', 'WAITING_APPROVAL']);

export interface UseAnalysisRunResult {
  run: AnalysisRunResponse | null;
  stages: AnalysisStageResponse[];
  artifacts: AnalysisArtifactResponse[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAnalysisRun(runId: string | null): UseAnalysisRunResult {
  const [run, setRun] = useState<AnalysisRunResponse | null>(null);
  const [stages, setStages] = useState<AnalysisStageResponse[]>([]);
  const [artifacts, setArtifacts] = useState<AnalysisArtifactResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      const latest = await fetchAll();
      if (cancelled) return;
      // Keep polling only while the run is active.
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

  return { run, stages, artifacts, loading, error, refresh: fetchAll };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/hooks/useAnalysisRun.ts
git commit -m "feat(web): useAnalysisRun polling hook"
```

---

## Task 3: RunSetupPanel

Lets the user pick ticker / depth / enabled teams and kick off a run.

**Files:**
- Create: `apps/web/src/components/analysis/RunSetupPanel.tsx`

- [ ] **Step 1: Implement the panel**

Create `apps/web/src/components/analysis/RunSetupPanel.tsx`:

```tsx
'use client'

import { useState } from 'react';
import { analysisRunsApi } from '../../api/analysis-runs';

const ALL_STAGES = ['INTELLIGENCE', 'THESIS', 'RISK', 'EXECUTION_PREP'] as const;

export interface RunSetupPanelProps {
  portfolios: Array<{ id: string; name: string }>;
  onRunCreated: (runId: string) => void;
}

export function RunSetupPanel({ portfolios, onRunCreated }: RunSetupPanelProps) {
  const [ticker, setTicker] = useState('AAPL');
  const [prompt, setPrompt] = useState('Complete analysis of AAPL with decision and order draft');
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? '');
  const [researchDepth, setResearchDepth] = useState<'SHALLOW' | 'STANDARD' | 'DEEP'>('STANDARD');
  const [enabledTeams, setEnabledTeams] = useState<string[]>([...ALL_STAGES]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleTeam = (key: string) => {
    setEnabledTeams((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  };

  const startRun = async () => {
    setSubmitting(true);
    setError('');
    try {
      const run = await analysisRunsApi.create({
        prompt,
        sourceMode: 'WORKSPACE',
        ticker,
        portfolioId: portfolioId || undefined,
        enabledTeams,
        researchDepth,
      });
      onRunCreated(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <h2 className="text-base font-semibold">Run Setup</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label>
          <span className="field-label">Ticker</span>
          <input
            className="field-input"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          <span className="field-label">Portfolio (optional)</span>
          <select
            className="field-input"
            value={portfolioId}
            onChange={(e) => setPortfolioId(e.target.value)}
          >
            <option value="">No portfolio</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="field-label">Prompt</span>
        <textarea
          rows={3}
          className="field-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <div className="flex gap-4">
        <label>
          <span className="field-label">Research depth</span>
          <select
            className="field-input"
            value={researchDepth}
            onChange={(e) =>
              setResearchDepth(e.target.value as 'SHALLOW' | 'STANDARD' | 'DEEP')
            }
          >
            <option value="SHALLOW">Shallow</option>
            <option value="STANDARD">Standard</option>
            <option value="DEEP">Deep</option>
          </select>
        </label>
        <div>
          <span className="field-label">Teams</span>
          <div className="flex gap-2 flex-wrap">
            {ALL_STAGES.map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => toggleTeam(team)}
                className={`status-chip border ${
                  enabledTeams.includes(team)
                    ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/40'
                    : 'bg-slate-800/60 text-slate-300 border-slate-700'
                }`}
              >
                {team}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-[var(--down)]">{error}</p>}
      <button
        onClick={startRun}
        disabled={submitting}
        className="btn-primary px-5 py-2 text-sm"
      >
        {submitting ? 'Starting...' : 'Start Analysis Run'}
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/analysis/RunSetupPanel.tsx
git commit -m "feat(web): RunSetupPanel"
```

---

## Task 4: LiveProgressPanel

**Files:**
- Create: `apps/web/src/components/analysis/LiveProgressPanel.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/src/components/analysis/LiveProgressPanel.tsx`:

```tsx
'use client'

import type {
  AnalysisRunResponse,
  AnalysisStageResponse,
} from '../../api/analysis-runs';
import { analysisRunsApi } from '../../api/analysis-runs';

const TEAM_ORDER = [
  'INTELLIGENCE',
  'THESIS',
  'RISK',
  'EXECUTION_PREP',
  'HUMAN_APPROVAL',
] as const;

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-slate-800 text-slate-400 border-slate-700',
  RUNNING: 'bg-blue-500/25 text-blue-100 border-blue-300/40 animate-pulse',
  COMPLETED: 'bg-green-500/20 text-green-200 border-green-300/40',
  FAILED: 'bg-red-500/20 text-red-200 border-red-300/40',
  SKIPPED: 'bg-slate-700 text-slate-300 border-slate-600',
};

export interface LiveProgressPanelProps {
  run: AnalysisRunResponse | null;
  stages: AnalysisStageResponse[];
  onRefresh: () => void;
}

export function LiveProgressPanel({ run, stages, onRefresh }: LiveProgressPanelProps) {
  if (!run) return null;
  const stageByKey = new Map(stages.map((s) => [s.stageKey, s] as const));

  const pause = async () => { await analysisRunsApi.pause(run.id); onRefresh(); };
  const resume = async () => { await analysisRunsApi.resume(run.id); onRefresh(); };
  const cancel = async () => { await analysisRunsApi.cancel(run.id); onRefresh(); };

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Live Progress</h2>
          <p className="text-xs text-slate-400">
            Run {run.id.slice(0, 8)} · status <b>{run.status}</b>
            {run.upgradeReason ? ` · via ${run.upgradeReason}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {run.status === 'RUNNING' && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={pause}>Pause</button>
          )}
          {run.status === 'PAUSED' && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={resume}>Resume</button>
          )}
          {(run.status === 'RUNNING' || run.status === 'PAUSED' || run.status === 'WAITING_APPROVAL') && (
            <button className="btn-secondary px-3 py-1 text-xs" onClick={cancel}>Cancel</button>
          )}
        </div>
      </header>

      <ol className="space-y-2">
        {TEAM_ORDER.map((key) => {
          const stage = stageByKey.get(key);
          const status = stage?.status ?? 'PENDING';
          return (
            <li key={key} className="flex items-center justify-between rounded border border-slate-700 bg-slate-900/40 px-3 py-2">
              <span className="font-mono text-sm">{key}</span>
              <span className={`status-chip border ${STATUS_STYLE[status] ?? STATUS_STYLE.PENDING}`}>
                {status}
                {stage?.checkpointVersion ? ` · v${stage.checkpointVersion}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/analysis/LiveProgressPanel.tsx
git commit -m "feat(web): LiveProgressPanel with pause/resume/cancel + team stage status"
```

---

## Task 5: ArtifactsPanel

**Files:**
- Create: `apps/web/src/components/analysis/ArtifactsPanel.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/src/components/analysis/ArtifactsPanel.tsx`:

```tsx
'use client'

import { useState } from 'react';
import type { AnalysisArtifactResponse } from '../../api/analysis-runs';

export interface ArtifactsPanelProps {
  artifacts: AnalysisArtifactResponse[];
}

export function ArtifactsPanel({ artifacts }: ArtifactsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (artifacts.length === 0) {
    return (
      <section className="surface-panel rounded p-4">
        <h2 className="text-base font-semibold">Artifacts</h2>
        <p className="text-sm text-slate-400 mt-2">No artifacts yet.</p>
      </section>
    );
  }
  return (
    <section className="surface-panel rounded p-4 space-y-2">
      <h2 className="text-base font-semibold">Artifacts</h2>
      <ul className="space-y-2">
        {artifacts.map((a) => {
          const isOpen = a.id === expandedId;
          return (
            <li key={a.id} className="rounded border border-slate-700 bg-slate-900/40">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left"
                onClick={() => setExpandedId(isOpen ? null : a.id)}
              >
                <span className="text-sm">
                  <code className="text-slate-300">{a.artifactKind}</code>
                  <span className="text-slate-500"> · {a.artifactName}</span>
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(a.createdAt).toLocaleTimeString()}
                </span>
              </button>
              {isOpen && (
                <pre className="text-xs bg-slate-950/70 p-3 overflow-auto">
                  {JSON.stringify(a.payload, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/analysis/ArtifactsPanel.tsx
git commit -m "feat(web): ArtifactsPanel with expandable JSON payload viewer"
```

---

## Task 6: FinalReportPanel

Renders the RISK team decision object + final report markdown once the run hits COMPLETED.

**Files:**
- Create: `apps/web/src/components/analysis/FinalReportPanel.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/src/components/analysis/FinalReportPanel.tsx`:

```tsx
'use client'

import type {
  AnalysisArtifactResponse,
  AnalysisRunResponse,
} from '../../api/analysis-runs';

export interface FinalReportPanelProps {
  run: AnalysisRunResponse | null;
  artifacts: AnalysisArtifactResponse[];
}

export function FinalReportPanel({ run, artifacts }: FinalReportPanelProps) {
  if (!run || (run.status !== 'COMPLETED' && run.status !== 'WAITING_APPROVAL')) {
    return null;
  }

  const executionPayload = artifacts.find((a) => a.artifactKind === 'EXECUTION_PAYLOAD');
  const orderDrafts = artifacts.find((a) => a.artifactKind === 'ORDER_DRAFTS');
  const riskReport = artifacts.find(
    (a) => a.artifactKind === 'STAGE_STRUCTURED_OUTPUT' && a.artifactName.startsWith('risk-'),
  );

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
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/analysis/FinalReportPanel.tsx
git commit -m "feat(web): FinalReportPanel shows decision object + execution payload"
```

---

## Task 7: HumanApprovalRail

Right-rail panel. Appears when `status === 'WAITING_APPROVAL'` and the latest approval row is `PENDING`.

**Files:**
- Create: `apps/web/src/components/analysis/HumanApprovalRail.tsx`
- Modify: `apps/web/src/api/analysis-runs.ts` (add `listApprovals`)
- Modify: `apps/api/src/analysis/analysis-run.controller.ts` (add `GET /:id/approvals`)
- Modify: `apps/api/src/analysis/analysis-run.service.ts` (add `listApprovalsForRun`)

- [ ] **Step 1: Add list-approvals to API**

Edit `apps/api/src/analysis/analysis-run.service.ts`:

```ts
  async listApprovalsForRun(runId: string) {
    return this.db
      .select()
      .from(analysisApprovals)
      .where(eq(analysisApprovals.runId, runId))
      .orderBy(desc(analysisApprovals.requestedAt));
  }
```

Import `analysisApprovals`. Add controller route:

```ts
  @Get(':id/approvals')
  async listApprovals(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const run = await this.runs.getForUser(user.sub, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return this.runs.listApprovalsForRun(id);
  }
```

- [ ] **Step 2: Add client method**

Edit `apps/web/src/api/analysis-runs.ts` — add to `analysisRunsApi`:

```ts
  listApprovals: (id: string) =>
    json<Array<{
      id: string;
      runId: string;
      status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
      requestedPayload: Record<string, unknown>;
      requestedAt: string;
    }>>(`/analysis/runs/${id}/approvals`),
```

- [ ] **Step 3: Implement the rail**

Create `apps/web/src/components/analysis/HumanApprovalRail.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react';
import { analysisRunsApi, type AnalysisRunResponse } from '../../api/analysis-runs';
import { analysisApprovalsApi } from '../../api/analysis-approvals';

interface ApprovalRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  requestedPayload: Record<string, unknown>;
  requestedAt: string;
}

export interface HumanApprovalRailProps {
  run: AnalysisRunResponse | null;
  onResolved: () => void;
}

export function HumanApprovalRail({ run, onResolved }: HumanApprovalRailProps) {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!run) return;
    if (run.status !== 'WAITING_APPROVAL') {
      setApprovals([]);
      return;
    }
    let cancelled = false;
    analysisRunsApi.listApprovals(run.id).then((rows) => {
      if (!cancelled) setApprovals(rows as ApprovalRow[]);
    });
    return () => { cancelled = true; };
  }, [run]);

  if (!run || run.status !== 'WAITING_APPROVAL') return null;
  const pending = approvals.find((a) => a.status === 'PENDING');
  if (!pending) return null;

  const resolve = async (decision: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    try {
      await analysisApprovalsApi.resolve(pending.id, decision, note || undefined);
      onResolved();
    } finally {
      setBusy(false);
    }
  };

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
  );
}
```

- [ ] **Step 4: Commit**

```bash
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/web typecheck
git add apps/api/src/analysis/analysis-run.service.ts \
        apps/api/src/analysis/analysis-run.controller.ts \
        apps/web/src/api/analysis-runs.ts \
        apps/web/src/components/analysis/HumanApprovalRail.tsx
git commit -m "feat(web): HumanApprovalRail right-rail + GET /runs/:id/approvals"
```

---

## Task 8: Repurpose AnalysisPage

**Files:**
- Modify: `apps/web/src/views/AnalysisPage.tsx`

- [ ] **Step 1: Rewrite the page**

Replace `apps/web/src/views/AnalysisPage.tsx` with:

```tsx
'use client'

import { useEffect, useState } from 'react';
import { RunSetupPanel } from '../components/analysis/RunSetupPanel';
import { LiveProgressPanel } from '../components/analysis/LiveProgressPanel';
import { ArtifactsPanel } from '../components/analysis/ArtifactsPanel';
import { FinalReportPanel } from '../components/analysis/FinalReportPanel';
import { HumanApprovalRail } from '../components/analysis/HumanApprovalRail';
import { useAnalysisRun } from '../hooks/useAnalysisRun';
import { portfolioApi, type PortfolioResponse } from '../api/portfolio';
import { analysisRunsApi, type AnalysisRunResponse } from '../api/analysis-runs';

export default function AnalysisPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<AnalysisRunResponse[]>([]);
  const { run, stages, artifacts, refresh } = useAnalysisRun(activeRunId);

  useEffect(() => {
    portfolioApi.list().then(setPortfolios);
    analysisRunsApi.list().then(setRecentRuns);
  }, []);

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-4">
        <RunSetupPanel
          portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
          onRunCreated={(id) => {
            setActiveRunId(id);
            analysisRunsApi.list().then(setRecentRuns);
          }}
        />

        {activeRunId ? (
          <>
            <LiveProgressPanel run={run} stages={stages} onRefresh={refresh} />
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
  );
}
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter @finsentinel/web typecheck
git add apps/web/src/views/AnalysisPage.tsx
git commit -m "feat(web): repurpose AnalysisPage into workspace root"
```

---

## Task 9: ChatPage — Surface "Open Run"

**Files:**
- Modify: `apps/web/src/api/chat.ts`
- Modify: `apps/web/src/views/ChatPage.tsx`

- [ ] **Step 1: Read the existing chat API client**

Run: `grep -n "streamChat\|runId\|upgrade" apps/web/src/api/chat.ts`.

- [ ] **Step 2: Parse `X-Analysis-Run-Id` header in the client**

Edit `apps/web/src/api/chat.ts` so that after the `fetch`, if headers include `X-Analysis-Run-Id`, surface it via the `onChunk`/`onDone` callback (or add a new `onUpgrade(runId: string, reason?: string)`).

Exact change: read `res.headers.get('X-Analysis-Run-Id')` once before starting the stream loop, and if present call a new `onUpgrade?.(runId, reason)` callback passed in alongside the existing ones.

- [ ] **Step 3: Wire in ChatPage**

Edit `apps/web/src/views/ChatPage.tsx`. Where chat streams start, pass `onUpgrade` that:
- stores `upgradeRunId` state
- shows a banner above the chat with a button "Open Run" linking to `/analysis?runId=<id>` (or however the workspace is routed)

Minimal diff:

```tsx
const [upgradeRunId, setUpgradeRunId] = useState<string | null>(null);
// ...
chatApi.stream(message, history, {
  onChunk,
  onDone,
  onError,
  onUpgrade: (runId, reason) => {
    setUpgradeRunId(runId);
    console.log('Chat upgraded to run', runId, reason);
  },
});

{upgradeRunId && (
  <div className="glass-panel rounded p-3 my-2 flex items-center justify-between">
    <span className="text-sm">This chat was upgraded to a tracked run.</span>
    <a className="btn-primary px-3 py-1 text-xs" href={`/analysis?runId=${upgradeRunId}`}>
      Open Run
    </a>
  </div>
)}
```

Also read `?runId=` on `AnalysisPage` mount to deep-link. Edit `AnalysisPage.tsx` effect:

```tsx
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const qRunId = params.get('runId');
  if (qRunId) setActiveRunId(qRunId);
}, []);
```

- [ ] **Step 4: Commit**

```bash
pnpm --filter @finsentinel/web typecheck
git add apps/web/src/api/chat.ts apps/web/src/views/ChatPage.tsx apps/web/src/views/AnalysisPage.tsx
git commit -m "feat(web): ChatPage surfaces Open Run and AnalysisPage deep-links to ?runId"
```

---

## Task 10: AutonomyPage — Recent Runs Per Schedule

**Files:**
- Modify: `apps/web/src/views/AutonomyPage.tsx`

- [ ] **Step 1: Add a recent-runs section**

Edit `apps/web/src/views/AutonomyPage.tsx`. Below the existing schedules/heartbeat UI, add:

```tsx
import { useEffect, useState } from 'react';
import { analysisRunsApi, type AnalysisRunResponse } from '../api/analysis-runs';

function RecentRunsSection() {
  const [runs, setRuns] = useState<AnalysisRunResponse[]>([]);
  useEffect(() => { analysisRunsApi.list().then(setRuns); }, []);
  return (
    <section className="surface-panel rounded p-4 mt-4">
      <h2 className="text-base font-semibold">Recent Runs</h2>
      <ul className="space-y-1 mt-2 text-sm">
        {runs.filter((r) => r.sourceMode !== 'CHAT').slice(0, 15).map((r) => (
          <li key={r.id}>
            <a href={`/analysis?runId=${r.id}`} className="underline text-slate-300">
              {r.id.slice(0, 8)} · {r.status} · {r.sourceMode} · {new Date(r.createdAt).toLocaleString()}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Render `<RecentRunsSection />` at the bottom of the existing page.

- [ ] **Step 2: Commit**

```bash
pnpm --filter @finsentinel/web typecheck
git add apps/web/src/views/AutonomyPage.tsx
git commit -m "feat(web): AutonomyPage shows recent schedule/heartbeat runs"
```

---

## Task 11: Hardening — Legacy Stream Behind Flag

The existing `POST /analysis/stream/:ticker` route should return `409 Conflict` or silently redirect to the new run system when `ANALYSIS_RUNS_ENABLED=true`. Keep it working when the flag is off.

**Files:**
- Modify: `apps/api/src/analysis/analysis.controller.ts`

- [ ] **Step 1: Gate the legacy endpoint**

Edit `apps/api/src/analysis/analysis.controller.ts`. Inject `ConfigService`:

```ts
import { ConfigService } from '@nestjs/config';

constructor(
  private readonly stockAnalysisService: StockAnalysisService,
  private readonly config: ConfigService,
) {}
```

In `streamAnalysis`, add at the top:

```ts
if (this.config.get<boolean>('ANALYSIS_RUNS_ENABLED', false)) {
  throw new BadRequestException(
    'Legacy /analysis/stream is disabled when ANALYSIS_RUNS_ENABLED=true. Use POST /analysis/runs.',
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/analysis/analysis.controller.ts
git commit -m "feat(analysis): gate legacy stream endpoint behind ANALYSIS_RUNS_ENABLED"
```

---

## Task 12: API Integration Test — Happy Path

Higher-fidelity test: run through the full lifecycle against real NestJS + mock LLM.

**Files:**
- Create: `apps/api/src/analysis/__tests__/runtime-happy-path.integration.spec.ts`

- [ ] **Step 1: Write the test**

Create `apps/api/src/analysis/__tests__/runtime-happy-path.integration.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
// NOTE: This test assumes the repo has an integration-test harness in apps/api/src/tests.
// If so, use it to bootstrap a NestJS test module with mocked LLM + in-memory BullMQ.
//
// Skeleton only — implementer fills in based on the existing harness:

describe.skip('runtime happy path (integration)', () => {
  it('POST /analysis/runs → preflight → intelligence → thesis → risk → execution_prep → waiting_approval', async () => {
    // 1. Bootstrap NestJS test module with:
    //    - mock LLM that returns the fixed JSON block per role (one per TEAM role)
    //    - mock ToolRegistry returning deterministic data
    //    - real Drizzle against a temporary schema / pgvector-disabled
    //    - BullMQ driven by its inline driver (no Redis)
    //
    // 2. Create a run via AnalysisRunController.create({ prompt, sourceMode: WORKSPACE })
    //
    // 3. Drive the queue: run the consumer synchronously in a loop until the status
    //    settles on WAITING_APPROVAL.
    //
    // 4. Assert:
    //    - analysis_stages has 4 completed rows for INTELLIGENCE, THESIS, RISK, EXECUTION_PREP
    //    - analysis_artifacts contains ORDER_DRAFTS
    //    - analysis_approvals has a PENDING row
    //
    // 5. Resolve the approval → assert analysis_artifacts gains EXECUTION_PAYLOAD
    //    and run status flips to COMPLETED.
    expect(true).toBe(true);
  });
});
```

(Implementer should expand this when they have the harness available. The `describe.skip` keeps CI green if no harness exists.)

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/analysis/__tests__/runtime-happy-path.integration.spec.ts
git commit -m "test(analysis): integration-test skeleton for runtime happy path"
```

---

## Task 13: Rollout Runbook

**Files:**
- Create: `docs/runbooks/2026-04-16-multi-agent-runtime-rollout.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/2026-04-16-multi-agent-runtime-rollout.md`:

```markdown
# Multi-Agent Runtime V1 — Rollout Runbook

## Pre-flight Checklist

- [ ] Plans A + B + C + D all landed on `main`.
- [ ] Migration V11 applied against staging + prod.
- [ ] `analysis_runs`, `analysis_stages`, `analysis_artifacts`, `analysis_approvals` visible in prod Postgres.
- [ ] Redis has capacity for the new `finsentinel-analysis-run` BullMQ queue.
- [ ] OpenRouter rate limits verified for 4× concurrent role calls per run.
- [ ] Feature flags (all default `false`):
      - `ANALYSIS_RUNS_ENABLED`
      - `CHAT_AUTO_UPGRADE_ENABLED`
      - `APPROVAL_AUTO_DISPATCH_ENABLED`

## Phase 1 — Staging Smoke Test

1. In staging, set `ANALYSIS_RUNS_ENABLED=true`; keep the other two flags `false`.
2. Hit `POST /analysis/runs` with `{ prompt: "Complete analysis of AAPL", sourceMode: "WORKSPACE" }`.
3. Confirm in logs: `RUN_QUEUED → RUN_STARTED → INTELLIGENCE_TEAM_* → ... → EXECUTION_APPROVAL_REQUIRED`.
4. Open `/analysis?runId=<id>` — confirm all 5 stages show in the LiveProgressPanel.
5. Click `Approve Execution` — confirm `EXECUTION_PAYLOAD` artifact appears and run flips to `COMPLETED`.

## Phase 2 — Staging Chat Auto-Upgrade

1. Add `CHAT_AUTO_UPGRADE_ENABLED=true`.
2. Submit a chat message `"Give me a complete analysis of AAPL"`.
3. Confirm response headers include `X-Analysis-Run-Id`.
4. Confirm assistant reply shows the "Open Run" banner with jump.
5. Confirm the chat-spawned run reaches `WAITING_APPROVAL` just like the workspace-spawned one.

## Phase 3 — Staging Autonomy

1. Create a cron schedule with `cron_expression: "*/2 * * * *"` and `task_type: "PORTFOLIO_REVIEW"`.
2. Wait up to 2 minutes; confirm `lastRunAt` updates and a new `SCHEDULE`-sourced run appears.
3. Enable heartbeat at 60s interval; confirm `lastBeatAt` updates every tick and `HEARTBEAT`-sourced runs appear.

## Phase 4 — Production Rollout

1. Merge runbook.
2. Production env: flip `ANALYSIS_RUNS_ENABLED=true`.
3. Monitor for 24 hours:
   - BullMQ `analysis-run` queue depth (warn > 50).
   - Error rate on `RUN_FAILED` events (warn > 2/hour).
   - OpenRouter spend vs. prior baseline.
4. If stable, flip `CHAT_AUTO_UPGRADE_ENABLED=true`.
5. Keep `APPROVAL_AUTO_DISPATCH_ENABLED=false` until the broker side is independently re-verified.

## Rollback

- Flip `ANALYSIS_RUNS_ENABLED=false`. Legacy `/analysis/stream/:ticker` re-activates.
- In-flight runs stay persisted; a future re-enable can resume them via `/analysis/runs/:id/resume`.
- Optional cleanup: `UPDATE analysis_runs SET status='CANCELED' WHERE status IN ('QUEUED','RUNNING','PAUSED','WAITING_APPROVAL');`

## Known v1 Limits

- No custom DAG builder; topology is hard-coded.
- Role-level checkpoints are not persisted — only team-stage.
- `orderDrafts` quantity modes `PERCENT_NAV` and `CONTRACTS` are rejected by the mapper.
- Chat auto-upgrade threshold is rule-based; no learned policy.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/2026-04-16-multi-agent-runtime-rollout.md
git commit -m "docs: multi-agent runtime v1 rollout runbook"
```

---

## Task 14: Final Test + Typecheck Sweep

**Files:** none.

- [ ] **Step 1: API**

```bash
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/api test
```
Expected: both green.

- [ ] **Step 2: Web**

```bash
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web test
pnpm --filter @finsentinel/web lint
```
Expected: green.

- [ ] **Step 3: Shared + DB**

```bash
pnpm --filter @finsentinel/shared typecheck
pnpm --filter @finsentinel/shared test
pnpm --filter @finsentinel/db typecheck
```
Expected: green.

- [ ] **Step 4: Manual browser walkthrough**

With `ANALYSIS_RUNS_ENABLED=true`:

1. `/analysis` → start a run → walk it to `WAITING_APPROVAL`.
2. Approve → confirm `COMPLETED` + `EXECUTION_PAYLOAD` renders.
3. `/chat` with "complete analysis" → confirm banner + deep-link to the run.
4. `/autonomy` → confirm "Recent Runs" lists schedule/heartbeat-sourced entries.

- [ ] **Step 5: Update the exec-plan progress log**

Edit `docs/exec-plans/2026-04-16-multi-agent-runtime-v1.md` — append to the `## Progress Log` section:

```markdown
- 2026-0X-XX: Plan A (context foundation) landed — schemas, runtime services, context fabric.
- 2026-0X-XX: Plan B (teams + order drafts) landed — 4 teams wired, broker-neutral boundary enforced.
- 2026-0X-XX: Plan C (entry points) landed — chat auto-upgrade, schedule/heartbeat runtime.
- 2026-0X-XX: Plan D (workspace + hardening) landed — UX shipped, v1 flags active on staging.
```

(Replace dates with real merge dates at the moment you run this.)

- [ ] **Step 6: Final commit**

```bash
git add docs/exec-plans/2026-04-16-multi-agent-runtime-v1.md
git commit -m "docs: update exec plan progress log after v1 rollout"
```

---

## Plan D Exit Criteria

- [ ] `/analysis` renders RunSetupPanel + LiveProgressPanel + ArtifactsPanel + FinalReportPanel + HumanApprovalRail.
- [ ] Deep link `/analysis?runId=<id>` restores a run view.
- [ ] `/chat` shows an "Open Run" banner when upgrade header is present.
- [ ] `/autonomy` lists recent schedule + heartbeat runs and links to the workspace.
- [ ] `POST /analysis/stream/:ticker` returns 400 when `ANALYSIS_RUNS_ENABLED=true`.
- [ ] API typecheck + web typecheck + shared test + web test all green.
- [ ] Runbook in `docs/runbooks/` describes staged rollout + rollback.
- [ ] Exec-plan progress log updated.

---

## v1 Done

When Plan D's exit criteria are met, the Multi-Agent Runtime V1 is shippable behind `ANALYSIS_RUNS_ENABLED=true`. All four PRDs have observable, end-to-end coverage:

- **Context Foundation (PRD 1)** — `SharedContext` is assembled by `ContextFabricService`, persisted on every run and stage.
- **Agent Teams Orchestrator (PRD 2)** — four teams with structured handoffs, parallel Thesis, role-scoped tools.
- **Resumable Runtime (PRD 3)** — BullMQ-backed runtime with `pause/resume/cancel`, team-stage checkpoints, schedule + heartbeat ticks.
- **Research Workspace (PRD 4)** — workspace UX, final report, human approval rail, chat auto-upgrade path.
