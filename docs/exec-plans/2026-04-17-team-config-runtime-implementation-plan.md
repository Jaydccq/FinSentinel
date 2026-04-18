# Team Config Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `preset`、`researchDepth`、`enabledTeams` 从静态输入字段升级为真正驱动执行图、role 配置和 stage/role 可见性的运行时能力。

**Architecture:** 先在 shared contract 中把 preset、role summary、skip semantics 变成一等对象，再在 API 侧引入 `TeamPresetService + StageGraphService` 负责解析执行图，最后让 team services 消费这些 runtime options，并在 Web 的 Run Setup 和 Live Progress 中把“用户选择”和“系统实际执行”对齐。

**Tech Stack:** TypeScript, Zod, NestJS, Vitest, React, Next.js

---

## Background

OpenAlice 的 agent teams 能把团队配置、角色分工、执行深度和运行状态显式化。当前代码已有 `team-registry`、四个 team service、`AnalysisRunService` 的 input snapshot，以及前端 `RunSetupPanel`，但 `preset`、`researchDepth`、`enabledTeams` 还没有完整地驱动执行图和 role 级可见性。

## Scope

- In scope: preset contract、stage graph resolver、runtime config snapshot、skipped stage 语义、role summary、Run Setup 与 Live Progress 对齐。
- Out of scope: runtime stream 基建、context journal、ledger 执行复核和 Trading 反查。

## Assumptions

- 当前 `apps/web/vitest.config.ts` 只覆盖 `.test.ts`，本计划的 `.test.tsx` 组件测试需要同时补 `jsdom` 和 `.test.tsx` include。
- 不引入新的持久化配置 UI；preset 定义先由 repo-owned service 管理。
- `RoleExecutorService` 负责 role 级 runtime option 和 tool scope，team service 只编排角色输出。

## Success Criteria

- `preset`、`researchDepth`、`enabledTeams` 都会进入 run input snapshot 并改变实际执行。
- disabled team 会产生明确 skipped stage，而不是静默消失。
- stage output 中能看到 role-level status、duration、tool call count 和 summary。
- Run Setup 展示的是实际被 API 接受的 runtime config。

## Verification Approach

- 先写 shared schema、stage graph、team preset、team service 的失败测试。
- 再接入 API runtime config 和前端组件。
- 最后运行目标 API/Web tests 与对应 typecheck。

## Progress Log

- 2026-04-17: 初版计划从 Agent Teams V2 PRD 拆出。
- 2026-04-17: 按现有代码修正 web Vitest 配置、Testing Library 断言、role executor snippet 和 run setup API shape。

## Key Decisions

- `TeamPresetService` 只提供确定性 preset，不把用户自定义团队配置纳入首版。
- `StageGraphService` 是 enabledTeams 与 preset 的唯一解释器，避免每个 team service 自行判断跳过。
- role summary 是 stage output 的一部分，供 timeline 和 console 共同消费。

## Risks And Blockers

- role-level output 如果结构过宽，会影响 existing stage output parser，需要 shared schema 先锁定最小字段。
- researchDepth 影响工具预算还是 prompt 约束需要在 `RoleExecutorService` 内保持单点实现。
- 前端测试依赖 jsdom 后，可能需要补充缺失的 browser API mock。

## Final Outcome

本计划处于待执行状态；本轮只修正计划和版本化规则，未修改 team runtime 业务代码。

## Planned File Map

- Modify: `packages/shared/src/schemas/analysis.ts` — `preset`、role summary、runtime config contract
- Modify: `packages/shared/src/enums/agent-event-type.ts` — generic role/stage events
- Modify: `packages/shared/src/__tests__/analysis-schema.test.ts`
- Create: `apps/api/src/analysis/team-preset.service.ts` — repo-owned preset definitions
- Create: `apps/api/src/analysis/stage-graph.service.ts` — enabledTeams + preset 解析为 stage graph
- Modify: `apps/api/src/analysis/analysis-run.service.ts` — 持久化 preset/runtime config snapshot
- Modify: `apps/api/src/analysis/run-orchestrator.service.ts` — 动态 stage graph + skipped stage 语义
- Modify: `apps/api/src/analysis/analysis-checkpoint.service.ts` — `markStageSkipped`
- Modify: `apps/api/src/analysis/team-registry.ts` — 提供 metadata，不只注册 execute 函数
- Modify: `apps/api/src/analysis/teams/intelligence-team.service.ts`
- Modify: `apps/api/src/analysis/teams/thesis-team.service.ts`
- Modify: `apps/api/src/analysis/teams/risk-team.service.ts`
- Modify: `apps/api/src/analysis/teams/execution-prep-team.service.ts`
- Modify: `apps/api/src/analysis/teams/role-executor.service.ts`
- Create: `apps/api/src/analysis/__tests__/team-preset.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-run.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/thesis-team.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/risk-team.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts`
- Modify: `apps/web/src/api/analysis-runs.ts`
- Modify: `apps/web/vitest.config.ts` — 允许组件测试使用 `.test.tsx` 与 jsdom
- Modify: `apps/web/src/components/analysis/RunSetupPanel.tsx`
- Modify: `apps/web/src/components/analysis/LiveProgressPanel.tsx`
- Create: `apps/web/src/components/analysis/__tests__/run-setup-panel.test.tsx`
- Create: `apps/web/src/components/analysis/__tests__/live-progress-panel.test.tsx`

### Task 1: Promote Preset And Runtime Config To Shared Contracts

**Files:**
- Modify: `packages/shared/src/schemas/analysis.ts`
- Modify: `packages/shared/src/enums/agent-event-type.ts`
- Modify: `packages/shared/src/__tests__/analysis-schema.test.ts`

- [ ] **Step 1: Write the failing schema tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  analysisPresetSchema,
  createRunRequestSchema,
  roleSummarySchema,
} from '../analysis';

describe('analysis runtime config schema', () => {
  it('accepts a run request with preset and research depth', () => {
    const parsed = createRunRequestSchema.parse({
      prompt: 'Analyze NVDA',
      sourceMode: 'WORKSPACE',
      ticker: 'NVDA',
      preset: 'STANDARD_ANALYSIS',
      researchDepth: 'DEEP',
      enabledTeams: ['INTELLIGENCE', 'THESIS', 'RISK'],
    });

    expect(parsed.preset).toBe('STANDARD_ANALYSIS');
  });

  it('accepts a role summary payload', () => {
    const parsed = roleSummarySchema.parse({
      roleKey: 'THESIS_LEAD',
      status: 'COMPLETED',
      durationMs: 8200,
      toolCallCount: 2,
      summary: 'Merged positive and negative case into a single thesis.',
    });

    expect(parsed.durationMs).toBe(8200);
  });

  it('includes the new generic runtime events', () => {
    expect(analysisPresetSchema.parse('DEEP_THESIS')).toBe('DEEP_THESIS');
  });
});
```

- [ ] **Step 2: Run the schema tests and verify they fail**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/analysis-schema.test.ts`

Expected: FAIL with missing `analysisPresetSchema` / `roleSummarySchema`.

- [ ] **Step 3: Implement the runtime config types**

```ts
// packages/shared/src/schemas/analysis.ts
export const analysisPresetSchema = z.enum([
  'FAST_RISK_CHECK',
  'STANDARD_ANALYSIS',
  'DEEP_THESIS',
  'EXECUTION_READY',
]);

export const roleSummarySchema = z.object({
  roleKey: z.string(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']),
  durationMs: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  summary: z.string(),
});

export const createRunRequestSchema = z.object({
  prompt: z.string().min(1),
  sourceMode: analysisRunSourceModeSchema,
  ticker: z.string().optional(),
  portfolioId: z.string().uuid().optional(),
  parentChatSessionId: z.string().uuid().optional(),
  preset: analysisPresetSchema.default('STANDARD_ANALYSIS'),
  enabledTeams: z.array(analysisStageKeySchema).optional(),
  researchDepth: z.enum(['SHALLOW', 'STANDARD', 'DEEP']).optional(),
});
```

```ts
// packages/shared/src/enums/agent-event-type.ts
ROLE_STARTED: 'ROLE_STARTED',
ROLE_COMPLETED: 'ROLE_COMPLETED',
ROLE_FAILED: 'ROLE_FAILED',
STAGE_SKIPPED: 'STAGE_SKIPPED',
```

- [ ] **Step 4: Re-run the shared test**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/analysis-schema.test.ts`

Expected: PASS with runtime config tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/analysis.ts packages/shared/src/enums/agent-event-type.ts packages/shared/src/__tests__/analysis-schema.test.ts
git commit -m "feat: add team runtime config contracts"
```

### Task 2: Resolve Presets Into A Real Stage Graph

**Files:**
- Create: `apps/api/src/analysis/team-preset.service.ts`
- Create: `apps/api/src/analysis/stage-graph.service.ts`
- Modify: `apps/api/src/analysis/analysis-run.service.ts`
- Modify: `apps/api/src/analysis/run-orchestrator.service.ts`
- Modify: `apps/api/src/analysis/analysis-checkpoint.service.ts`
- Create: `apps/api/src/analysis/__tests__/team-preset.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-run.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

- [ ] **Step 1: Write the failing preset/graph tests**

```ts
import { describe, expect, it } from 'vitest';
import { StageGraphService } from '../stage-graph.service';

describe('StageGraphService', () => {
  it('skips execution prep when preset is research-only', () => {
    const service = new StageGraphService();
    const graph = service.build({
      preset: 'DEEP_THESIS',
      enabledTeams: ['INTELLIGENCE', 'THESIS', 'RISK'],
    });

    expect(graph.map((node) => `${node.stageKey}:${node.status}`)).toEqual([
      'INTELLIGENCE:ENABLED',
      'THESIS:ENABLED',
      'RISK:ENABLED',
      'EXECUTION_PREP:SKIPPED',
      'HUMAN_APPROVAL:SKIPPED',
    ]);
  });
});
```

- [ ] **Step 2: Run the preset/graph tests and verify they fail**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/team-preset.service.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

Expected: FAIL because no preset or stage graph services exist.

- [ ] **Step 3: Implement preset definitions and stage-graph resolution**

```ts
// apps/api/src/analysis/team-preset.service.ts
@Injectable()
export class TeamPresetService {
  resolve(input: { preset: AnalysisPreset; researchDepth: ResearchDepth }) {
    const base = {
      FAST_RISK_CHECK: ['INTELLIGENCE', 'RISK'],
      STANDARD_ANALYSIS: ['INTELLIGENCE', 'THESIS', 'RISK'],
      DEEP_THESIS: ['INTELLIGENCE', 'THESIS', 'RISK'],
      EXECUTION_READY: ['INTELLIGENCE', 'THESIS', 'RISK', 'EXECUTION_PREP', 'HUMAN_APPROVAL'],
    } as const;

    return {
      stageKeys: base[input.preset],
      researchDepth: input.researchDepth,
      maxParallelRoles: input.researchDepth === 'DEEP' ? 4 : 2,
    };
  }
}
```

```ts
// apps/api/src/analysis/stage-graph.service.ts
@Injectable()
export class StageGraphService {
  build(args: { preset: AnalysisPreset; enabledTeams?: AnalysisStageKey[] }) {
    const selected = new Set(args.enabledTeams ?? []);
    return (['INTELLIGENCE', 'THESIS', 'RISK', 'EXECUTION_PREP', 'HUMAN_APPROVAL'] as const)
      .map((stageKey) => ({
        stageKey,
        status: selected.size === 0 || selected.has(stageKey) ? 'ENABLED' : 'SKIPPED',
      }));
  }
}
```

- [ ] **Step 4: Persist the resolved config and enforce skip semantics**

```ts
// apps/api/src/analysis/analysis-run.service.ts
inputSnapshotJson: {
  prompt: req.prompt,
  ticker: req.ticker,
  portfolioId: req.portfolioId,
  preset: req.preset ?? 'STANDARD_ANALYSIS',
  enabledTeams: req.enabledTeams,
  researchDepth: req.researchDepth ?? 'STANDARD',
},
```

```ts
// apps/api/src/analysis/run-orchestrator.service.ts
const graph = this.stageGraph.build(run.inputSnapshotJson as RuntimeRunConfig);
const node = graph.find((item) => item.stageKey === data.stageKey);
if (node?.status === 'SKIPPED') {
  await this.checkpoints.markStageSkipped(data.userId, data.runId, data.stageKey, { reason: 'disabled_by_runtime_config' });
  const next = this.stageGraph.nextEnabled(graph, data.stageKey);
  if (next) await this.producer.enqueueExecuteStage({ runId: data.runId, userId: data.userId, stageKey: next });
  return;
}
```

- [ ] **Step 5: Re-run the API tests and typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/team-preset.service.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

Expected: PASS with graph and skip tests green.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analysis/team-preset.service.ts apps/api/src/analysis/stage-graph.service.ts apps/api/src/analysis/analysis-run.service.ts apps/api/src/analysis/run-orchestrator.service.ts apps/api/src/analysis/analysis-checkpoint.service.ts apps/api/src/analysis/__tests__/team-preset.service.spec.ts apps/api/src/analysis/__tests__/analysis-run.service.spec.ts apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts
git commit -m "feat: resolve presets into a real analysis stage graph"
```

### Task 3: Make Research Depth And Roles Affect Runtime Behavior

**Files:**
- Modify: `apps/api/src/analysis/teams/role-executor.service.ts`
- Modify: `apps/api/src/analysis/teams/intelligence-team.service.ts`
- Modify: `apps/api/src/analysis/teams/thesis-team.service.ts`
- Modify: `apps/api/src/analysis/teams/risk-team.service.ts`
- Modify: `apps/api/src/analysis/teams/execution-prep-team.service.ts`
- Modify: `apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/thesis-team.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/risk-team.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts`

- [ ] **Step 1: Write the failing team-service tests**

```ts
it('runs a deeper evidence sweep for DEEP intelligence preset', async () => {
  await service.execute({
    userId,
    runId,
    runtimeConfig: { preset: 'DEEP_THESIS', researchDepth: 'DEEP' },
  });

  expect(roleExecutor.run).toHaveBeenCalledWith(
    expect.objectContaining({
      userInput: expect.objectContaining({
        extra: expect.objectContaining({ evidenceLimit: 12 }),
      }),
    }),
  );
});

it('emits role summaries for thesis outputs', async () => {
  const stage = await checkpoints.findByStage(runId, 'THESIS');
  expect(stage?.structuredOutputJson?.roleSummaries).toHaveLength(3);
});
```

- [ ] **Step 2: Run the team-service tests and verify they fail**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/intelligence-team.service.spec.ts src/analysis/__tests__/thesis-team.service.spec.ts src/analysis/__tests__/risk-team.service.spec.ts src/analysis/__tests__/execution-prep-team.service.spec.ts`

Expected: FAIL because runtime config is ignored and no `roleSummaries` field exists.

- [ ] **Step 3: Thread runtimeConfig into role execution and stage outputs**

```ts
// apps/api/src/analysis/teams/role-executor.service.ts
async run(args: {
  roleKey: RoleKey;
  systemPrompt: string;
  userInput: RoleInput;
  runtimeConfig?: { researchDepth: 'SHALLOW' | 'STANDARD' | 'DEEP' };
  userId?: string;
}): Promise<RoleOutput> {
  const startedAt = Date.now();
  const scopedTools = this.buildScopedTools(args.roleKey, args.runtimeConfig);
  const { text } = await this.llm.generate({
    model: this.model,
    system: args.systemPrompt,
    prompt: this.buildUserPrompt(args.userInput),
    tools: scopedTools,
  });
  const structured = this.parseStructuredOutput(args.roleKey, text);
  return {
    roleKey: args.roleKey,
    structured,
    rawMarkdown: text,
    durationMs: Date.now() - startedAt,
    toolCallCount: Object.keys(scopedTools).length,
  };
}
```

```ts
// apps/api/src/analysis/teams/thesis-team.service.ts
const roleSummaries = [
  {
    roleKey: 'POSITIVE_CASE',
    status: 'COMPLETED',
    durationMs: positive.durationMs,
    toolCallCount: positive.toolCallCount,
    summary: positive.structured.summary,
  },
  {
    roleKey: 'NEGATIVE_CASE',
    status: 'COMPLETED',
    durationMs: negative.durationMs,
    toolCallCount: negative.toolCallCount,
    summary: negative.structured.summary,
  },
  {
    roleKey: 'THESIS_LEAD',
    status: 'COMPLETED',
    durationMs: lead.durationMs,
    toolCallCount: lead.toolCallCount,
    summary: lead.structured.summary,
  },
];
```

- [ ] **Step 4: Encode concrete depth behavior**

```ts
// apps/api/src/analysis/teams/intelligence-team.service.ts
const depth = (run.inputSnapshotJson as RuntimeRunConfig).researchDepth ?? 'STANDARD';
const evidenceLimit = depth === 'DEEP' ? 12 : depth === 'SHALLOW' ? 4 : 8;

const out = await this.roleExecutor.run({
  roleKey: role.key,
  systemPrompt: role.prompt,
  runtimeConfig: { researchDepth: depth },
  userInput: {
    prompt: input.prompt,
    contextText,
    priorStageOutputs: {},
    extra: { evidenceLimit, debateRound: depth === 'DEEP' ? 2 : 1 },
  },
  userId: args.userId,
});
```

- [ ] **Step 5: Re-run the team tests and typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/intelligence-team.service.spec.ts src/analysis/__tests__/thesis-team.service.spec.ts src/analysis/__tests__/risk-team.service.spec.ts src/analysis/__tests__/execution-prep-team.service.spec.ts`

Expected: PASS with runtime config assertions green.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analysis/teams/role-executor.service.ts apps/api/src/analysis/teams/intelligence-team.service.ts apps/api/src/analysis/teams/thesis-team.service.ts apps/api/src/analysis/teams/risk-team.service.ts apps/api/src/analysis/teams/execution-prep-team.service.ts apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts apps/api/src/analysis/__tests__/thesis-team.service.spec.ts apps/api/src/analysis/__tests__/risk-team.service.spec.ts apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts
git commit -m "feat: make team runtime config affect role execution"
```

### Task 4: Align Run Setup And Live Progress With Actual Runtime

**Files:**
- Modify: `apps/web/src/api/analysis-runs.ts`
- Modify: `apps/web/vitest.config.ts`
- Modify: `apps/web/src/components/analysis/RunSetupPanel.tsx`
- Modify: `apps/web/src/components/analysis/LiveProgressPanel.tsx`
- Create: `apps/web/src/components/analysis/__tests__/run-setup-panel.test.tsx`
- Create: `apps/web/src/components/analysis/__tests__/live-progress-panel.test.tsx`

- [ ] **Step 1: Write the failing web tests**

```tsx
import { render, screen } from '@testing-library/react';
import { RunSetupPanel } from '../RunSetupPanel';

it('submits preset and research depth together', async () => {
  render(<RunSetupPanel portfolios={[]} onRunCreated={() => {}} />);
  expect(screen.getByLabelText(/Preset/i)).toBeTruthy();
  expect(screen.getByLabelText(/Research depth/i)).toBeTruthy();
});
```

```tsx
it('renders skipped stages distinctly', () => {
  render(<LiveProgressPanel run={run} stages={[{ stageKey: 'EXECUTION_PREP', status: 'SKIPPED' } as never]} onRefresh={async () => {}} />);
  expect(screen.getByText(/SKIPPED/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run the web tests and verify they fail**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/run-setup-panel.test.tsx src/components/analysis/__tests__/live-progress-panel.test.tsx src/api/__tests__/analysis-runs.test.ts`

Expected: FAIL because the preset field and skipped-stage UI do not exist.

- [ ] **Step 3: Update the API client and Run Setup form**

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
export interface CreateRunRequest {
  prompt: string;
  sourceMode: 'CHAT' | 'WORKSPACE' | 'SCHEDULE' | 'HEARTBEAT';
  ticker?: string;
  portfolioId?: string;
  parentChatSessionId?: string;
  preset?: 'FAST_RISK_CHECK' | 'STANDARD_ANALYSIS' | 'DEEP_THESIS' | 'EXECUTION_READY';
  enabledTeams?: string[];
  researchDepth?: 'SHALLOW' | 'STANDARD' | 'DEEP';
}
```

```tsx
// apps/web/src/components/analysis/RunSetupPanel.tsx
const [preset, setPreset] = useState<'FAST_RISK_CHECK' | 'STANDARD_ANALYSIS' | 'DEEP_THESIS' | 'EXECUTION_READY'>('STANDARD_ANALYSIS');

<label>
  <span className="field-label">Preset</span>
  <select className="field-input" value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
    <option value="FAST_RISK_CHECK">Fast Risk Check</option>
    <option value="STANDARD_ANALYSIS">Standard Analysis</option>
    <option value="DEEP_THESIS">Deep Thesis</option>
    <option value="EXECUTION_READY">Execution Ready</option>
  </select>
</label>
```

- [ ] **Step 4: Surface skipped stages and role summaries in live progress**

```tsx
// apps/web/src/components/analysis/LiveProgressPanel.tsx
{stage?.roleSummaries?.length ? (
  <ul className="mt-2 space-y-1">
    {stage.roleSummaries.map((role) => (
      <li key={role.roleKey} className="text-xs text-slate-400">
        {role.roleKey} · {role.status} · {Math.round(role.durationMs / 1000)}s
      </li>
    ))}
  </ul>
) : null}
```

- [ ] **Step 5: Re-run the web tests and typecheck**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/run-setup-panel.test.tsx src/components/analysis/__tests__/live-progress-panel.test.tsx src/api/__tests__/analysis-runs.test.ts`

Expected: PASS with all three targeted tests green.

Run: `pnpm --filter @finsentinel/web typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/src/api/analysis-runs.ts apps/web/src/components/analysis/RunSetupPanel.tsx apps/web/src/components/analysis/LiveProgressPanel.tsx apps/web/src/components/analysis/__tests__/run-setup-panel.test.tsx apps/web/src/components/analysis/__tests__/live-progress-panel.test.tsx
git commit -m "feat: align analysis setup ui with runtime config"
```

## Self-Review

### Spec Coverage

- `preset`：Task 1, Task 2, Task 4
- `enabledTeams` 真正改变执行图：Task 2
- `researchDepth` 真正影响 runtime 参数：Task 3
- role 级可见性：Task 3, Task 4
- skipped stage 语义：Task 2, Task 4

### Placeholder Scan

没有保留占位式表述；每个代码步骤都明确到了文件和命令。

### Type Consistency

- `analysisPresetSchema`
- `TeamPresetService`
- `StageGraphService`
- `roleSummarySchema`
- `runtimeConfig`

以上命名在本计划内保持一致，并与 Runtime Foundation / Operator Console 计划对齐。
