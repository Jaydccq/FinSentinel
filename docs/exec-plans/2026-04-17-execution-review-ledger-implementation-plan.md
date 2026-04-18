# Execution Review Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 analysis approval、staging、commit、dispatch、execute 串成一条可查看、可确认、可复盘的执行复核账本，并打通 Trading 反查。

**Architecture:** 先在 shared/db 增加 `execution_review_ledgers` 契约和表结构，再引入 `ExecutionReviewLedgerService` 负责状态推进。`AnalysisApprovalService` 只负责决策边界和草案映射，真正的执行状态由 ledger service 驱动；`UnifiedTradingService` 回填 commit hash、execute result 和 source run metadata，前端在 Analysis 与 Trading 两侧都能查看同一条 ledger。

**Tech Stack:** TypeScript, Zod, NestJS, Drizzle ORM, Redis, Vitest, React, Next.js

---

## Background

当前代码已有 `AnalysisApprovalService`、`ExecutionPrepTeamService` 和 `UnifiedTradingService` 的 staging/commit 能力，但 approval、order draft artifact、staging、commit、dispatch、execute 之间没有一条可查询、可复盘的业务账本。OpenAlice 对照后的工业级方向要求 execution 不能埋在事件流里，必须形成显式 human-in-the-loop ledger。

## Scope

- In scope: execution ledger shared/db contract、ledger service、approval 与 draft artifact 绑定、staging/commit/dispatch/execute 状态推进、Analysis/Trading 两侧展示。
- Out of scope: broker 真实下单接入、策略优化、runtime stream 基建和 team preset 行为。

## Assumptions

- `ExecutionPrepTeamService` 现在先创建 `ORDER_DRAFTS` artifact，再调用 approval request；本计划会把 `artifact.id` 显式传入 approval/ledger。
- `UnifiedTradingService.commit(userId, message)` 可向后兼容地增加 optional metadata，不破坏现有调用。
- Drizzle migration 输出目录遵循当前 `packages/db/drizzle.config.ts` 的 `out: "./drizzle"`。

## Success Criteria

- 每个 execution approval 都能反查 order draft artifact 与 ledger id。
- approval 通过后进入 staged/committed/dispatched/executed 或 failed/rejected 的明确状态。
- Trading 页面能从 commit/execution 反查 source run、approval 和 ledger。
- auto-dispatch 失败会写入 ledger failure，不只停留在 event 或 Redis staging 里。

## Verification Approach

- 先写 shared ledger schema、ledger service、approval service 的失败测试。
- 再接入 execution prep、trading commit metadata 和前端 ledger panel。
- 最后运行目标 API/Web tests 与对应 typecheck。

## Progress Log

- 2026-04-17: 初版计划从 Execution Review Ledger PRD 拆出。
- 2026-04-17: 按现有代码修正 approval request 参数、order draft artifact 绑定、`UnifiedTradingService.commit` optional metadata、Drizzle 输出路径、web Vitest 配置和前端字段命名。

## Key Decisions

- Approval 不是 ledger 本体；approval 是 human decision boundary，ledger 是执行状态机。
- order draft artifact 是 execution ledger 的第一手输入，不能只存 payload copy。
- commit/dispatch/execute 都必须可追踪到 run 和 approval，Trading 页面不再只显示交易侧 hash。

## Risks And Blockers

- 如果现有 trading tests 假设 commit 返回值固定，需要同步更新为兼容 optional metadata 的断言。
- Ledger 状态推进涉及 Redis staging 和 DB ledger 两套状态，需要测试失败补偿路径。
- 自动派发应默认保守，避免 approval 通过后立即触发真实执行的边界不清。

## Final Outcome

本计划处于待执行状态；本轮只修正计划和版本化规则，未修改 ledger/trading 业务代码。

## Planned File Map

- Create: `packages/shared/src/schemas/execution-ledger.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/schemas/trading.ts`
- Create: `packages/shared/src/__tests__/execution-ledger-schema.test.ts`
- Create: `packages/db/src/schema/execution-review-ledgers.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/relations.ts`
- Create: `apps/api/src/analysis/execution-review-ledger.service.ts`
- Create: `apps/api/src/analysis/analysis-ledger.controller.ts`
- Modify: `apps/api/src/analysis/analysis.module.ts`
- Modify: `apps/api/src/analysis/analysis-approval.service.ts`
- Modify: `apps/api/src/analysis/teams/execution-prep-team.service.ts`
- Modify: `apps/api/src/analysis/analysis-run.controller.ts`
- Modify: `apps/api/src/trading/unified-trading.service.ts`
- Modify: `apps/api/src/trading/trading.controller.ts`
- Create: `apps/api/src/analysis/__tests__/execution-review-ledger.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts`
- Modify: `apps/api/src/trading/__tests__/unified-trading.service.spec.ts`
- Modify: `apps/web/src/api/analysis-runs.ts`
- Modify: `apps/web/src/api/analysis-approvals.ts`
- Modify: `apps/web/src/api/trading.ts`
- Modify: `apps/web/vitest.config.ts` — 允许组件测试使用 `.test.tsx` 与 jsdom
- Create: `apps/web/src/components/analysis/ExecutionLedgerPanel.tsx`
- Modify: `apps/web/src/components/analysis/HumanApprovalRail.tsx`
- Modify: `apps/web/src/components/analysis/FinalReportPanel.tsx`
- Modify: `apps/web/src/views/TradingPage.tsx`
- Create: `apps/web/src/components/analysis/__tests__/execution-ledger-panel.test.tsx`

### Task 1: Add Shared And Database Contracts For The Ledger

**Files:**
- Create: `packages/shared/src/schemas/execution-ledger.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/schemas/trading.ts`
- Create: `packages/shared/src/__tests__/execution-ledger-schema.test.ts`
- Create: `packages/db/src/schema/execution-review-ledgers.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/relations.ts`

- [ ] **Step 1: Write the failing shared-schema test**

```ts
import { describe, expect, it } from 'vitest';
import { executionReviewLedgerSchema } from '../execution-ledger';

describe('executionReviewLedgerSchema', () => {
  it('parses a staged ledger record', () => {
    const parsed = executionReviewLedgerSchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      runId: '22222222-2222-2222-2222-222222222222',
      approvalId: '33333333-3333-3333-3333-333333333333',
      status: 'STAGED',
      orderDraftRefs: ['artifact-1'],
      stagedOperationRefs: ['op-1', 'op-2'],
      commitHash: null,
      executionResultRef: null,
      rejectionNote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(parsed.status).toBe('STAGED');
  });
});
```

- [ ] **Step 2: Run the shared test and verify it fails**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/execution-ledger-schema.test.ts`

Expected: FAIL because `execution-ledger` exports do not exist.

- [ ] **Step 3: Implement the ledger schema and DB table**

```ts
// packages/shared/src/schemas/execution-ledger.ts
import { z } from 'zod';

export const executionReviewLedgerStatusSchema = z.enum([
  'DRAFTED',
  'STAGED',
  'COMMITTED',
  'APPROVED',
  'DISPATCHED',
  'EXECUTED',
  'REJECTED',
  'FAILED',
]);

export const executionReviewLedgerSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  approvalId: z.string().uuid(),
  status: executionReviewLedgerStatusSchema,
  orderDraftRefs: z.array(z.string()),
  stagedOperationRefs: z.array(z.string()),
  commitHash: z.string().nullable(),
  executionResultRef: z.string().nullable(),
  rejectionNote: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

```ts
// packages/db/src/schema/execution-review-ledgers.ts
import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import { analysisApprovals } from './analysis-approvals';

export const executionReviewLedgers = pgTable('execution_review_ledgers', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  approvalId: uuid('approval_id').notNull().references(() => analysisApprovals.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull(),
  orderDraftRefsJson: jsonb('order_draft_refs_json').$type<string[]>().notNull().default([]),
  stagedOperationRefsJson: jsonb('staged_operation_refs_json').$type<string[]>().notNull().default([]),
  commitHash: varchar('commit_hash', { length: 128 }),
  executionResultRef: varchar('execution_result_ref', { length: 255 }),
  rejectionNote: varchar('rejection_note', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_execution_review_ledgers_run').on(table.runId, table.updatedAt.desc()),
  index('idx_execution_review_ledgers_approval').on(table.approvalId),
]);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @finsentinel/db db:generate`

Expected: a new migration file for `execution_review_ledgers` under `packages/db/drizzle/`, because `packages/db/drizzle.config.ts` sets `out: "./drizzle"`.

- [ ] **Step 5: Re-run the schema test and package typechecks**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/execution-ledger-schema.test.ts`

Expected: PASS with `1 passed`.

Run: `pnpm --filter @finsentinel/db typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/execution-ledger.ts packages/shared/src/schemas/index.ts packages/shared/src/schemas/trading.ts packages/shared/src/__tests__/execution-ledger-schema.test.ts packages/db/src/schema/execution-review-ledgers.ts packages/db/src/schema/index.ts packages/db/src/schema/relations.ts packages/db/drizzle
git commit -m "feat: add execution review ledger contracts"
```

### Task 2: Create The Ledger Service And Wire Approval Resolution

**Files:**
- Create: `apps/api/src/analysis/execution-review-ledger.service.ts`
- Modify: `apps/api/src/analysis/analysis-approval.service.ts`
- Modify: `apps/api/src/analysis/teams/execution-prep-team.service.ts`
- Modify: `apps/api/src/analysis/analysis.module.ts`
- Create: `apps/api/src/analysis/__tests__/execution-review-ledger.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ExecutionReviewLedgerService } from '../execution-review-ledger.service';

describe('ExecutionReviewLedgerService', () => {
  it('creates a drafted ledger when approval is requested', async () => {
    const db = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: 'ledger-1' }]) }) } as never;
    const service = new ExecutionReviewLedgerService(db);
    const ledger = await service.createDraft({
      runId: 'run-1',
      approvalId: 'approval-1',
      orderDraftRefs: ['artifact-1'],
    });
    expect(ledger.id).toBe('ledger-1');
  });
});
```

```ts
it('marks the ledger rejected when approval is rejected', async () => {
  await service.resolve({ userId, approvalId, decision: 'REJECT', note: 'Too much sizing risk' });
  expect(ledgerService.markRejected).toHaveBeenCalledWith(expect.objectContaining({
    approvalId,
    note: 'Too much sizing risk',
  }));
});
```

- [ ] **Step 2: Run the approval/ledger tests and verify they fail**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/execution-review-ledger.service.spec.ts src/analysis/__tests__/analysis-approval.service.spec.ts`

Expected: FAIL because no ledger service exists and approval resolution does not call it.

- [ ] **Step 3: Implement the ledger service**

```ts
// apps/api/src/analysis/execution-review-ledger.service.ts
@Injectable()
export class ExecutionReviewLedgerService {
  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  async createDraft(args: { runId: string; approvalId: string; orderDraftRefs: string[] }) {
    const [row] = await this.db.insert(executionReviewLedgers).values({
      runId: args.runId,
      approvalId: args.approvalId,
      status: 'DRAFTED',
      orderDraftRefsJson: args.orderDraftRefs,
      stagedOperationRefsJson: [],
      updatedAt: new Date(),
    }).returning();
    return row;
  }

  async markRejected(args: { approvalId: string; note?: string }) {
    await this.db.update(executionReviewLedgers).set({
      status: 'REJECTED',
      rejectionNote: args.note ?? null,
      updatedAt: new Date(),
    }).where(eq(executionReviewLedgers.approvalId, args.approvalId));
  }
}
```

- [ ] **Step 4: Wire request/approve/reject to the ledger**

```ts
// apps/api/src/analysis/analysis-approval.service.ts
async request(args: {
  userId: string;
  runId: string;
  payload: OrderDraftsPayload;
  orderDraftArtifactId: string;
}): Promise<ApprovalRow> {
  const parsed = orderDraftsPayloadSchema.parse(args.payload);
  const [row] = await this.db.insert(analysisApprovals).values({
    id: randomUUID(),
    runId: args.runId,
    approvalType: 'EXECUTION_APPROVAL',
    status: 'PENDING',
    requestedPayloadJson: parsed as unknown as Record<string, unknown>,
    requestedAt: new Date(),
  }).returning();
  const approval = row as ApprovalRow;
  await this.ledger.createDraft({
    runId: args.runId,
    approvalId: approval.id,
    orderDraftRefs: [args.orderDraftArtifactId],
  });
  return approval;
}
```

```ts
// apps/api/src/analysis/teams/execution-prep-team.service.ts
await this.approvals.request({
  userId: args.userId,
  runId: args.runId,
  payload: validated,
  orderDraftArtifactId: artifact.id,
});
```

```ts
if (args.decision === 'APPROVE') {
  await this.ledger.markApproved({ approvalId: args.approvalId });
} else {
  await this.ledger.markRejected({ approvalId: args.approvalId, note: args.note });
}
```

- [ ] **Step 5: Re-run the approval/ledger tests and typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/execution-review-ledger.service.spec.ts src/analysis/__tests__/analysis-approval.service.spec.ts`

Expected: PASS with ledger transition tests green.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analysis/execution-review-ledger.service.ts apps/api/src/analysis/analysis-approval.service.ts apps/api/src/analysis/teams/execution-prep-team.service.ts apps/api/src/analysis/analysis.module.ts apps/api/src/analysis/__tests__/execution-review-ledger.service.spec.ts apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts
git commit -m "feat: create execution review ledger service"
```

### Task 3: Add Manual Commit/Dispatch Paths And Trading Back-Links

**Files:**
- Create: `apps/api/src/analysis/analysis-ledger.controller.ts`
- Modify: `apps/api/src/trading/unified-trading.service.ts`
- Modify: `apps/api/src/trading/trading.controller.ts`
- Modify: `apps/api/src/analysis/execution-review-ledger.service.ts`
- Modify: `apps/api/src/trading/__tests__/unified-trading.service.spec.ts`

- [ ] **Step 1: Write the failing trading/ledger tests**

```ts
it('persists ledger metadata in the commit history', async () => {
  await service.commitFromLedger(userId, {
    ledgerId: 'ledger-1',
    runId: 'run-1',
    message: 'analysis run run-1',
  });

  expect(redis.setex).toHaveBeenCalledWith(
    expect.stringContaining(userId),
    expect.any(Number),
    expect.stringContaining('"ledgerId":"ledger-1"'),
  );
});
```

```ts
it('exposes POST /analysis/ledgers/:id/commit and /dispatch', async () => {
  await controller.commitLedger('ledger-1', mockUser);
  expect(ledgerService.commit).toHaveBeenCalledWith(mockUser.userId, 'ledger-1');
});
```

- [ ] **Step 2: Run the trading/ledger tests and verify they fail**

Run: `pnpm --filter @finsentinel/api test -- src/trading/__tests__/unified-trading.service.spec.ts src/analysis/__tests__/execution-review-ledger.service.spec.ts`

Expected: FAIL because there is no ledger-aware commit/dispatch path.

- [ ] **Step 3: Add ledger-aware commit and execute metadata**

```ts
// apps/api/src/trading/unified-trading.service.ts
interface CommitData {
  hash: string;
  message: string;
  timestamp: string;
  operations: Record<string, unknown>[];
  metadata?: {
    ledgerId?: string;
    runId?: string;
  };
}

async commit(userId: string, message: string, metadata?: { ledgerId?: string; runId?: string }) {
  const commitData: CommitData = {
    hash,
    message,
    timestamp,
    operations: ops,
    metadata,
  };
  await this.redis.setex(pendingKey, STATE_TTL_SECONDS, JSON.stringify(commitData));
  await this.clearStagingArea(userId);
  return { hash, count: ops.length };
}
```

- [ ] **Step 4: Add ledger endpoints and state transitions**

```ts
// apps/api/src/analysis/analysis-ledger.controller.ts
@Controller('analysis/ledgers')
@UseGuards(JwtGuard)
export class AnalysisLedgerController {
  constructor(private readonly ledger: ExecutionReviewLedgerService) {}

  @Post(':id/commit')
  async commitLedger(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    await this.ledger.commit(user.userId, id);
    return { ok: true };
  }

  @Post(':id/dispatch')
  async dispatchLedger(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    await this.ledger.dispatch(user.userId, id);
    return { ok: true };
  }
}
```

```ts
// apps/api/src/analysis/execution-review-ledger.service.ts
async commit(userId: string, ledgerId: string) {
  const ledger = await this.requireLedger(ledgerId);
  const result = await this.trading.commit(userId, `analysis run ${ledger.runId}`, { ledgerId, runId: ledger.runId });
  await this.markCommitted({ ledgerId, commitHash: result.hash });
}
```

- [ ] **Step 5: Re-run the trading/ledger tests and typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/trading/__tests__/unified-trading.service.spec.ts src/analysis/__tests__/execution-review-ledger.service.spec.ts`

Expected: PASS with ledger-aware commit tests green.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analysis/analysis-ledger.controller.ts apps/api/src/trading/unified-trading.service.ts apps/api/src/trading/trading.controller.ts apps/api/src/analysis/execution-review-ledger.service.ts apps/api/src/trading/__tests__/unified-trading.service.spec.ts
git commit -m "feat: add ledger commit and dispatch controls"
```

### Task 4: Render The Ledger In Analysis And Trading UI

**Files:**
- Modify: `apps/web/src/api/analysis-runs.ts`
- Modify: `apps/web/src/api/analysis-approvals.ts`
- Modify: `apps/web/src/api/trading.ts`
- Modify: `apps/web/vitest.config.ts`
- Create: `apps/web/src/components/analysis/ExecutionLedgerPanel.tsx`
- Modify: `apps/web/src/components/analysis/HumanApprovalRail.tsx`
- Modify: `apps/web/src/components/analysis/FinalReportPanel.tsx`
- Modify: `apps/web/src/views/TradingPage.tsx`
- Create: `apps/web/src/components/analysis/__tests__/execution-ledger-panel.test.tsx`

- [ ] **Step 1: Write the failing ledger UI test**

```tsx
import { render, screen } from '@testing-library/react';
import { ExecutionLedgerPanel } from '../ExecutionLedgerPanel';

it('renders draft -> staged -> committed status and action buttons', () => {
  render(<ExecutionLedgerPanel ledger={{
    id: 'ledger-1',
    runId: 'run-1',
    approvalId: 'approval-1',
    status: 'STAGED',
    orderDraftRefs: ['artifact-1'],
    stagedOperationRefs: ['BUY:AAPL', 'SELL:MSFT'],
    commitHash: null,
    executionResultRef: null,
    rejectionNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }} />);

  expect(screen.getByText(/STAGED/i)).toBeTruthy();
  expect(screen.getByText(/BUY:AAPL/)).toBeTruthy();
});
```

- [ ] **Step 2: Run the ledger UI test and verify it fails**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/execution-ledger-panel.test.tsx`

Expected: FAIL because the ledger panel does not exist.

- [ ] **Step 3: Add API methods and the ledger panel**

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
getLedger: (runId: string) =>
  json<ExecutionReviewLedgerResponse[]>(`/analysis/runs/${runId}/ledger`),
commitLedger: (ledgerId: string) =>
  json<{ ok: true }>(`/analysis/ledgers/${ledgerId}/commit`, { method: 'POST' }),
dispatchLedger: (ledgerId: string) =>
  json<{ ok: true }>(`/analysis/ledgers/${ledgerId}/dispatch`, { method: 'POST' }),
```

```tsx
// apps/web/src/components/analysis/ExecutionLedgerPanel.tsx
export function ExecutionLedgerPanel({ ledger, onCommit, onDispatch }: Props) {
  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <h2 className="text-base font-semibold">Execution Ledger</h2>
      <p className="text-xs text-slate-400">Status: {ledger.status}</p>
      <ul className="space-y-1 text-sm">
        {ledger.stagedOperationRefs.map((op) => <li key={op}>{op}</li>)}
      </ul>
      {!ledger.commitHash ? <button className="btn-secondary px-3 py-1 text-xs" onClick={onCommit}>Create Commit</button> : null}
      {ledger.commitHash && ledger.status !== 'EXECUTED' ? <button className="btn-primary px-3 py-1 text-xs" onClick={onDispatch}>Dispatch</button> : null}
    </section>
  );
}
```

- [ ] **Step 4: Integrate the ledger into Analysis and Trading**

```tsx
// apps/web/src/components/analysis/HumanApprovalRail.tsx
<ExecutionLedgerPanel
  ledger={ledger}
  onCommit={() => analysisRunsApi.commitLedger(ledger.id).then(onResolved)}
  onDispatch={() => analysisRunsApi.dispatchLedger(ledger.id).then(onResolved)}
/>
```

```tsx
// apps/web/src/views/TradingPage.tsx
{history.map((commit) => (
  <li key={commit.hash}>
    <div className="flex items-center justify-between">
      <span>{truncHash(commit.hash)}</span>
      {commit.metadata?.runId ? (
        <a className="text-xs underline text-slate-300" href={`/analysis?runId=${commit.metadata.runId}`}>
          Source Run
        </a>
      ) : null}
    </div>
  </li>
))}
```

- [ ] **Step 5: Re-run the ledger UI test and web typecheck**

Run: `pnpm --filter @finsentinel/web test -- src/components/analysis/__tests__/execution-ledger-panel.test.tsx`

Expected: PASS with ledger rendering test green.

Run: `pnpm --filter @finsentinel/web typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/src/api/analysis-runs.ts apps/web/src/api/analysis-approvals.ts apps/web/src/api/trading.ts apps/web/src/components/analysis/ExecutionLedgerPanel.tsx apps/web/src/components/analysis/HumanApprovalRail.tsx apps/web/src/components/analysis/FinalReportPanel.tsx apps/web/src/views/TradingPage.tsx apps/web/src/components/analysis/__tests__/execution-ledger-panel.test.tsx
git commit -m "feat: surface execution review ledger in analysis and trading ui"
```

## Self-Review

### Spec Coverage

- ledger 一等对象：Task 1
- approval -> draft/stage/commit/dispatch/execute：Task 2, Task 3
- rejection 可追溯：Task 2
- manual commit / dispatch：Task 3
- Analysis / Trading 两侧可见：Task 4

### Placeholder Scan

没有使用空占位、延后实现或复用上文的模糊写法；每个步骤都包含明确文件、命令和代码块。

### Type Consistency

- `executionReviewLedgerSchema`
- `ExecutionReviewLedgerService`
- `AnalysisLedgerController`
- `ExecutionLedgerPanel`

以上命名在本计划内一致，并与 Operator Console 计划中的 UI 集成点对齐。
