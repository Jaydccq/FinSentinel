# Operator Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Analysis 页升级成统一的 operator console，让用户能在同一工作流里查看 live timeline、context lineage、artifacts、final decision，并从 Chat / Autonomy 无缝进入。

**Architecture:** 基于 Runtime Foundation 提供的 `/analysis/runs/:id/stream`、`/context`、`/stage input` API，前端新增 `useAnalysisTimeline` 和 console 组件树。页面结构固定为 navigator + workspace + control rail，Artifacts 与 Final Decision 不再直接打印 JSON，而是按 markdown、JSON tree、role summary 分层渲染。

**Tech Stack:** React 19, Next.js App Router, TypeScript, Testing Library, Vitest

---

## Background

当前 Analysis 页已经能创建 run 并轮询状态，但核心信息仍分散在 run、stage、artifact 和 approval 的原始数据里。OpenAlice 的使用体验差距在于缺少一个同屏的 operator console：用户应能看到 timeline、context lineage、artifacts、final decision 和人工控制点，而不是在 Chat、Analysis、Autonomy 间断裂跳转。

## Scope

- In scope: analysis runs client 增强、SSE/cursor hook、navigator/workspace/control rail 布局、context/artifact/final report 渲染、Chat/Autonomy 到同一 run console 的入口。
- Out of scope: 新增 runtime API、team runtime 行为、execution ledger 后端状态机。

## Assumptions

- Runtime Foundation 会提供 `/analysis/runs/:id/stream`、`/context`、`/stages/:stageKey/input`。
- 当前 auth guard 支持 `FS_AUTH` cookie，所以 EventSource 可使用 cookie credentials，不需要把 bearer token 塞入 query string。
- 前端 run response 先兼容当前 DB-shaped 字段，如 `decisionObjectJson`、`sharedContextJson`、`inputSnapshotJson`。

## Success Criteria

- Analysis 页能以 run 为中心展示 live timeline、context、artifacts、final decision。
- Chat 和 Autonomy 进入的 run 都落到同一 console 视图。
- SSE 失败时 cursor polling fallback 仍能补齐事件。
- UI 组件测试覆盖 timeline、context、artifact renderer 和 API client shape。

## Verification Approach

- 先补 `apps/web/vitest.config.ts` 的 `.test.tsx` 与 jsdom 支持。
- 写 hook/API/component 的失败测试，再实现最小 console 组件树。
- 运行目标 web tests 与 `pnpm --filter @finsentinel/web typecheck`。

## Progress Log

- 2026-04-17: 初版计划从 Analysis Operator Console PRD 拆出。
- 2026-04-17: 按现有代码修正 EventSource auth 假设、run response 字段、Vitest TSX/jsdom 配置、Testing Library 断言和 `AnalysisPage` 组件示例。
- 2026-04-18 (status sync): PR #12 (`codex/operator-console-timeline-ui`) landed a working slice — `TimelinePanel`, fetch-based SSE stream helper (`analysisRunsApi.stream` with cursor-replay), `useAnalysisRun` now owns timeline + fallback polling, `ChatPage` "Open Run" live card, `AutonomyPage` "Recent Runs" section, 2-column Analysis workspace. Still missing: `RunNavigator`, `ContextPanel`, `ArtifactRenderer`, `JsonTree`, `getContext`/`getStageInput` API client methods, replacement of `JSON.stringify` in `FinalReportPanel` + `ArtifactsPanel`, and `apps/web/vitest.config.ts` jsdom/`.test.tsx` support. The standalone `useAnalysisTimeline` hook in the original Task 1 is SUPERSEDED by `useAnalysisRun` — do not reintroduce it. Remaining work consolidated in [openalice remaining-work plan](2026-04-18-openalice-remaining-work-plan.md) Phase 2.

## Key Decisions

- Analysis 是主工作台；Chat 与 Autonomy 只提供入口，不各自复制 run console。
- artifacts 使用 typed renderer，而不是继续直接打印 JSON。
- Control rail 只展示人工控制与 approval，不承担新的后端状态逻辑。

## Risks And Blockers

- 若 Runtime Foundation API 未先落地，console 只能做 fallback polling，体验会退化。
- EventSource 在不同浏览器下的 cookie 行为需要手动验证一次。
- 组件拆分后要避免把主体验包进装饰性 card，保持工作台直接可用。

## Final Outcome

本计划处于部分完成状态。PR #12 交付了 timeline SSE、runtime control wiring、live card 和 Autonomy 反向链接。剩余 console 组件和 renderer 合并进 [openalice remaining-work plan](2026-04-18-openalice-remaining-work-plan.md) Phase 2 继续执行。

## Planned File Map

- Modify: `apps/web/src/api/analysis-runs.ts` — stream/context/stage-input client
- Modify: `apps/web/vitest.config.ts` — 允许组件测试使用 `.test.tsx` 与 jsdom
- Create: `apps/web/src/hooks/useAnalysisTimeline.ts` — SSE + cursor fallback hook
- Modify: `apps/web/src/hooks/useAnalysisRun.ts` — stream-first, polling fallback
- Create: `apps/web/src/components/analysis/RunNavigator.tsx`
- Create: `apps/web/src/components/analysis/TimelinePanel.tsx`
- Create: `apps/web/src/components/analysis/ContextPanel.tsx`
- Create: `apps/web/src/components/analysis/ArtifactRenderer.tsx`
- Create: `apps/web/src/components/analysis/JsonTree.tsx`
- Modify: `apps/web/src/components/analysis/ArtifactsPanel.tsx`
- Modify: `apps/web/src/components/analysis/FinalReportPanel.tsx`
- Modify: `apps/web/src/components/analysis/HumanApprovalRail.tsx`
- Modify: `apps/web/src/views/AnalysisPage.tsx`
- Modify: `apps/web/src/views/ChatPage.tsx`
- Modify: `apps/web/src/views/AutonomyPage.tsx`
- Create: `apps/web/src/components/analysis/__tests__/timeline-panel.test.tsx`
- Create: `apps/web/src/components/analysis/__tests__/context-panel.test.tsx`
- Create: `apps/web/src/components/analysis/__tests__/artifact-renderer.test.tsx`
- Create: `apps/web/src/hooks/__tests__/use-analysis-timeline.test.tsx`
- Modify: `apps/web/src/api/__tests__/analysis-runs.test.ts`

### Task 1: Add Stream-First Analysis Data Access

**Files:**
- Modify: `apps/web/src/api/analysis-runs.ts`
- Modify: `apps/web/vitest.config.ts`
- Create: `apps/web/src/hooks/useAnalysisTimeline.ts`
- Modify: `apps/web/src/hooks/useAnalysisRun.ts`
- Create: `apps/web/src/hooks/__tests__/use-analysis-timeline.test.tsx`
- Modify: `apps/web/src/api/__tests__/analysis-runs.test.ts`

- [ ] **Step 1: Write the failing hook/API tests**

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAnalysisTimeline } from '../useAnalysisTimeline';

describe('useAnalysisTimeline', () => {
  it('subscribes to the run stream and appends events in order', async () => {
    const createEventSource = vi.fn();
    renderHook(() => useAnalysisTimeline('run-1', { createEventSource }));
    expect(createEventSource).toHaveBeenCalledWith('run-1', expect.any(Function));
  });
});
```

```ts
it('requests context and stage input from the new analysis endpoints', async () => {
  await analysisRunsApi.getContext('run-1');
  await analysisRunsApi.getStageInput('run-1', 'THESIS');
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/analysis/runs/run-1/context'), expect.anything());
});
```

- [ ] **Step 2: Run the web tests and verify they fail**

Run: `pnpm --filter @finsentinel/web test -- src/hooks/__tests__/use-analysis-timeline.test.tsx src/api/__tests__/analysis-runs.test.ts`

Expected: FAIL because the new client functions and hook do not exist.

- [ ] **Step 3: Implement the analysis stream client and hook**

```ts
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
  },
});
```

```ts
// apps/web/src/api/analysis-runs.ts
export interface AnalysisRunResponse {
  id: string;
  userId: string;
  sourceMode: string;
  status: 'QUEUED' | 'RUNNING' | 'WAITING_APPROVAL' | 'PAUSED' | 'FAILED' | 'COMPLETED' | 'CANCELED';
  currentStageKey: string | null;
  inputSnapshotJson: Record<string, unknown>;
  sharedContextJson: SharedContext | null;
  decisionObjectJson: Record<string, unknown> | null;
  finalReportMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

getContext: (id: string) => json<SharedContext>(`/analysis/runs/${id}/context`),
getStageInput: (id: string, stageKey: string) =>
  json<Record<string, unknown>>(`/analysis/runs/${id}/stages/${stageKey}/input`),
subscribeRun: (id: string, onMessage: (event: MessageEvent) => void) => {
  const source = new EventSource(`${BASE}/analysis/runs/${id}/stream`, { withCredentials: true });
  source.onmessage = onMessage;
  return source;
},
```

```tsx
// apps/web/src/hooks/useAnalysisTimeline.ts
export function useAnalysisTimeline(
  runId: string | null,
  deps = { createEventSource: analysisRunsApi.subscribeRun },
) {
  const [events, setEvents] = useState<RuntimeTimelineEvent[]>([]);

  useEffect(() => {
    if (!runId) return;
    const source = deps.createEventSource(runId, (message) => {
      const next = JSON.parse(message.data) as RuntimeTimelineEvent;
      setEvents((current) => [...current, next].sort((a, b) => a.seqNo - b.seqNo));
    });
    return () => source.close();
  }, [runId]);

  return { events };
}
```

- [ ] **Step 4: Refactor `useAnalysisRun` to prefer stream updates**

```tsx
// apps/web/src/hooks/useAnalysisRun.ts
const { events } = useAnalysisTimeline(runId);

useEffect(() => {
  if (!runId) return;
  refresh();
}, [runId, refresh]);

useEffect(() => {
  if (!events.length) return;
  const last = events[events.length - 1];
  if (['RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELED'].includes(last.eventType)) {
    refresh();
  }
}, [events, refresh]);
```

- [ ] **Step 5: Re-run the hook/API tests and typecheck**

Run: `pnpm --filter @finsentinel/web test -- src/hooks/__tests__/use-analysis-timeline.test.tsx src/api/__tests__/analysis-runs.test.ts`

Expected: PASS with stream and endpoint tests green.

Run: `pnpm --filter @finsentinel/web typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/src/api/analysis-runs.ts apps/web/src/hooks/useAnalysisTimeline.ts apps/web/src/hooks/useAnalysisRun.ts apps/web/src/hooks/__tests__/use-analysis-timeline.test.tsx apps/web/src/api/__tests__/analysis-runs.test.ts
git commit -m "feat: add stream-first analysis data hooks"
```

### Task 2: Build The Console Shell And Core Panels

**Files:**
- Create: `apps/web/src/components/analysis/RunNavigator.tsx`
- Create: `apps/web/src/components/analysis/TimelinePanel.tsx`
- Create: `apps/web/src/components/analysis/ContextPanel.tsx`
- Modify: `apps/web/src/views/AnalysisPage.tsx`
- Create: `apps/web/src/components/analysis/__tests__/timeline-panel.test.tsx`
- Create: `apps/web/src/components/analysis/__tests__/context-panel.test.tsx`

- [ ] **Step 1: Write the failing panel tests**

```tsx
import { render, screen } from '@testing-library/react';
import { TimelinePanel } from '../TimelinePanel';

it('renders ordered runtime events', () => {
  render(<TimelinePanel events={[
    { id: '1', seqNo: 10, aggregateId: 'run-1', eventType: 'RUN_STARTED', payload: {}, createdAt: new Date().toISOString() },
    { id: '2', seqNo: 11, aggregateId: 'run-1', eventType: 'ROLE_COMPLETED', payload: { roleKey: 'THESIS_LEAD' }, createdAt: new Date().toISOString() },
  ]} />);

  expect(screen.getByText(/RUN_STARTED/)).toBeTruthy();
  expect(screen.getByText(/THESIS_LEAD/)).toBeTruthy();
});
```

```tsx
it('renders context layers with lineage counts', () => {
  render(<ContextPanel context={{
    longTermPreferenceContext: { summary: 'risk aware', sourceIds: [], updatedAt: new Date().toISOString(), lineage: ['ctx-1'] },
    midTermStrategyContext: { summary: 'swing', sourceIds: [], updatedAt: new Date().toISOString(), lineage: [] },
    shortTermSessionContext: { summary: 'chat compacted', sourceIds: [], updatedAt: new Date().toISOString(), lineage: ['ctx-2', 'ctx-3'] },
    retrievalContext: { summary: 'earnings beat', sourceIds: ['news-1'], updatedAt: new Date().toISOString(), lineage: ['rag-1'] },
  }} />);

  expect(screen.getByText(/2 lineage items/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run the panel tests and verify they fail**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/timeline-panel.test.tsx src/components/analysis/__tests__/context-panel.test.tsx`

Expected: FAIL because the panels do not exist.

- [ ] **Step 3: Implement `RunNavigator`, `TimelinePanel`, and `ContextPanel`**

```tsx
// apps/web/src/components/analysis/TimelinePanel.tsx
export function TimelinePanel({ events }: { events: RuntimeTimelineEvent[] }) {
  return (
    <section className="surface-panel rounded p-4 space-y-2">
      <h2 className="text-base font-semibold">Timeline</h2>
      <ol className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="rounded border border-slate-700 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{event.eventType}</span>
              <span>#{event.seqNo}</span>
            </div>
            {event.payload.roleKey ? (
              <p className="mt-1 text-sm text-slate-200">{String(event.payload.roleKey)}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

```tsx
// apps/web/src/components/analysis/ContextPanel.tsx
function ContextCard({ title, layer }: { title: string; layer: ContextLayerWithLineage }) {
  return (
    <article className="rounded border border-slate-700 bg-slate-900/40 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm whitespace-pre-wrap">{layer.summary || '(empty)'}</p>
      <p className="mt-2 text-xs text-slate-400">{layer.lineage.length} lineage items</p>
    </article>
  );
}
```

- [ ] **Step 4: Refactor `AnalysisPage` into navigator + workspace + rail**

```tsx
// apps/web/src/views/AnalysisPage.tsx
<div className="grid grid-cols-1 2xl:grid-cols-[280px_1fr_340px] gap-4">
  <RunNavigator recentRuns={recentRuns} activeRunId={activeRunId} onSelect={setActiveRunId} />
  <div className="space-y-4">
    <RunSetupPanel
      portfolios={portfolios.map((portfolio) => ({ id: portfolio.id, name: portfolio.name }))}
      onRunCreated={setActiveRunId}
    />
    <TimelinePanel events={timeline.events} />
    <ContextPanel context={context} />
    <ArtifactsPanel artifacts={artifacts} />
    <FinalReportPanel run={run} artifacts={artifacts} />
  </div>
  <HumanApprovalRail run={run} onResolved={() => refresh()} />
</div>
```

- [ ] **Step 5: Re-run the panel tests and typecheck**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/timeline-panel.test.tsx src/components/analysis/__tests__/context-panel.test.tsx`

Expected: PASS with both panel tests green.

Run: `pnpm --filter @finsentinel/web typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/analysis/RunNavigator.tsx apps/web/src/components/analysis/TimelinePanel.tsx apps/web/src/components/analysis/ContextPanel.tsx apps/web/src/views/AnalysisPage.tsx apps/web/src/components/analysis/__tests__/timeline-panel.test.tsx apps/web/src/components/analysis/__tests__/context-panel.test.tsx
git commit -m "feat: add analysis operator console shell"
```

### Task 3: Replace Raw JSON With Human-Readable Artifacts And Final Decision

**Files:**
- Create: `apps/web/src/components/analysis/ArtifactRenderer.tsx`
- Create: `apps/web/src/components/analysis/JsonTree.tsx`
- Modify: `apps/web/src/components/analysis/ArtifactsPanel.tsx`
- Modify: `apps/web/src/components/analysis/FinalReportPanel.tsx`
- Create: `apps/web/src/components/analysis/__tests__/artifact-renderer.test.tsx`

- [ ] **Step 1: Write the failing artifact-renderer test**

```tsx
import { render, screen } from '@testing-library/react';
import { ArtifactRenderer } from '../ArtifactRenderer';

it('renders markdown and structured json differently', () => {
  const { rerender } = render(
    <ArtifactRenderer artifact={{ artifactKind: 'STAGE_HUMAN_REPORT', artifactName: 'risk-report.md', mimeType: 'text/markdown', payload: { markdown: '# Risk' } } as never} />,
  );
  expect(screen.getByText(/Risk/)).toBeTruthy();

  rerender(
    <ArtifactRenderer artifact={{ artifactKind: 'STAGE_STRUCTURED_OUTPUT', artifactName: 'risk.json', mimeType: 'application/json', payload: { confidence: 0.82 } } as never} />,
  );
  expect(screen.getByText(/confidence/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run the artifact tests and verify they fail**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/artifact-renderer.test.tsx`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement `ArtifactRenderer` and `JsonTree`**

```tsx
// apps/web/src/components/analysis/ArtifactRenderer.tsx
export function ArtifactRenderer({ artifact }: { artifact: AnalysisArtifactResponse }) {
  if (artifact.mimeType === 'text/markdown') {
    return <pre className="whitespace-pre-wrap text-sm">{String(artifact.payload?.markdown ?? '')}</pre>;
  }

  if (artifact.mimeType === 'application/json') {
    return <JsonTree value={artifact.payload} />;
  }

  return <p className="text-sm text-slate-400">Unsupported artifact format: {artifact.mimeType}</p>;
}
```

```tsx
// apps/web/src/components/analysis/JsonTree.tsx
export function JsonTree({ value }: { value: unknown }) {
  if (value == null) return <span className="text-slate-500">null</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  return (
    <ul className="space-y-1 text-xs">
      {Object.entries(value as Record<string, unknown>).map(([key, nested]) => (
        <li key={key}>
          <span className="text-slate-400">{key}</span>: <JsonTree value={nested} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Replace the existing panels with renderer-based views**

```tsx
// apps/web/src/components/analysis/ArtifactsPanel.tsx
{isOpen && (
  <div className="p-3">
    <ArtifactRenderer artifact={a} />
  </div>
)}
```

```tsx
// apps/web/src/components/analysis/FinalReportPanel.tsx
<section className="surface-panel rounded p-4 space-y-3">
  <h2 className="text-base font-semibold">Final Decision</h2>
  {run.finalReportMarkdown ? <pre className="whitespace-pre-wrap text-sm">{run.finalReportMarkdown}</pre> : null}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
    <JsonTree value={run.decisionObjectJson ?? riskReport?.payload ?? null} />
    <JsonTree value={executionPayload?.payload ?? orderDrafts?.payload ?? null} />
  </div>
</section>
```

- [ ] **Step 5: Re-run the renderer test and typecheck**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/artifact-renderer.test.tsx`

Expected: PASS with renderer test green.

Run: `pnpm --filter @finsentinel/web typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/analysis/ArtifactRenderer.tsx apps/web/src/components/analysis/JsonTree.tsx apps/web/src/components/analysis/ArtifactsPanel.tsx apps/web/src/components/analysis/FinalReportPanel.tsx apps/web/src/components/analysis/__tests__/artifact-renderer.test.tsx
git commit -m "feat: render analysis artifacts as readable console views"
```

### Task 4: Connect Chat And Autonomy Into The Same Console

**Files:**
- Modify: `apps/web/src/views/ChatPage.tsx`
- Modify: `apps/web/src/views/AutonomyPage.tsx`
- Modify: `apps/web/src/components/analysis/HumanApprovalRail.tsx`

- [ ] **Step 1: Write the failing Chat/Autonomy integration tests**

```tsx
it('shows a live run card inside chat after auto-upgrade', () => {
  render(<ChatPage />);
  expect(screen.getByText(/Open Run/)).toBeTruthy();
  expect(screen.getByText(/tracked run/i)).toBeTruthy();
});
```

```tsx
it('links recent autonomy runs into the analysis console', () => {
  render(<AutonomyPage />);
  expect(screen.getByText(/Recent Runs/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run the web suite slice and verify it fails**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/timeline-panel.test.tsx src/components/analysis/__tests__/context-panel.test.tsx src/components/analysis/__tests__/artifact-renderer.test.tsx`

Expected: FAIL or partial-fail because the chat/autonomy links and rail content are not yet aligned.

- [ ] **Step 3: Turn the chat banner into a run live card**

```tsx
// apps/web/src/views/ChatPage.tsx
{upgradeRunId && (
  <div className="surface-panel rounded p-3 my-2 space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-sm">
        This request is running in the operator console{upgradeReason ? ` (${upgradeReason})` : ''}.
      </span>
      <a className="btn-primary px-3 py-1 text-xs" href={`/analysis?runId=${upgradeRunId}`}>
        Open Run
      </a>
    </div>
    <p className="text-xs text-slate-400">Timeline, context lineage, approval, and final decision live in the same run workspace.</p>
  </div>
)}
```

- [ ] **Step 4: Add console links to Autonomy and strengthen the approval rail**

```tsx
// apps/web/src/views/AutonomyPage.tsx
<section className="surface-panel rounded p-4">
  <h2 className="text-base font-semibold">Recent Runs</h2>
  <ul className="mt-2 space-y-1">
    {recentRuns.slice(0, 8).map((run) => (
      <li key={run.id}>
        <a className="text-sm underline text-slate-300" href={`/analysis?runId=${run.id}`}>
          {run.id.slice(0, 8)} · {run.status} · {run.sourceMode}
        </a>
      </li>
    ))}
  </ul>
</section>
```

```tsx
// apps/web/src/components/analysis/HumanApprovalRail.tsx
<aside className="surface-panel rounded p-4 sticky top-4 space-y-3">
  <h2 className="text-base font-semibold">Control Rail</h2>
  <p className="text-xs text-slate-400">Approval blocks execution-only actions. Research artifacts remain visible in the workspace.</p>
  {pendingApproval ? (
    <>
      <pre className="max-h-56 overflow-auto rounded bg-slate-950/70 p-2 text-xs">
        {JSON.stringify(pendingApproval.requestedPayload, null, 2)}
      </pre>
      <textarea
        className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional approval note"
      />
      <button className="btn-primary w-full" disabled={busy} onClick={() => resolve('APPROVED')}>
        Approve Execution
      </button>
      <button className="btn-secondary w-full" disabled={busy} onClick={() => resolve('REJECTED')}>
        Reject
      </button>
    </>
  ) : (
    <p className="text-xs text-slate-500">No execution approval is waiting.</p>
  )}
</aside>
```

- [ ] **Step 5: Run the full targeted web suite and typecheck**

Run: `pnpm --filter @finsentinel/web test -- src/hooks/__tests__/use-analysis-timeline.test.tsx src/components/analysis/__tests__/timeline-panel.test.tsx src/components/analysis/__tests__/context-panel.test.tsx src/components/analysis/__tests__/artifact-renderer.test.tsx src/api/__tests__/analysis-runs.test.ts`

Expected: PASS with the console-oriented workflow tests green.

Run: `pnpm --filter @finsentinel/web typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/ChatPage.tsx apps/web/src/views/AutonomyPage.tsx apps/web/src/components/analysis/HumanApprovalRail.tsx
git commit -m "feat: connect chat and autonomy flows to the operator console"
```

## Self-Review

### Spec Coverage

- Timeline：Task 1, Task 2
- Context lineage：Task 1, Task 2
- Human-readable artifacts：Task 3
- Final decision：Task 3
- Chat inline run card：Task 4
- Autonomy -> console routing：Task 4

### Placeholder Scan

没有使用占位语言；每个实现步骤都给出明确组件、hook、API 和命令。

### Type Consistency

- `useAnalysisTimeline`
- `TimelinePanel`
- `ContextPanel`
- `ArtifactRenderer`
- `JsonTree`

以上命名在本计划内一致，并与 Runtime Foundation 的 API 路径保持一致。
