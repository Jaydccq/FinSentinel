# Runtime & Context Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 FinSentinel 的统一上下文账本、可恢复控制面、run stream API，以及 run 级物化产物落库闭环。

**Architecture:** 先在 `packages/shared` 和 `packages/db` 增加统一上下文与 timeline 契约，再在 `apps/api/src/analysis` 内引入 `ContextJournalService`、`RuntimeControlService`、`RunReportAssembler`。Chat compaction、analysis stage input、run streaming、pause/resume、final materialization 都围绕同一套 journal + event + run snapshot 语义收敛。

**Tech Stack:** TypeScript, Zod, Drizzle ORM, PostgreSQL, NestJS, BullMQ, RxJS, Vitest

---

## Background

OpenAlice 的关键差距集中在运行时真相链：上下文谱系、run timeline、暂停恢复、stage input 快照、最终报告物化都需要落到同一套可查询的运行时记录里。当前代码已有 `AnalysisRunService`、`ContextFabricService`、`AgentEventService`、`ChatCompactionService` 和 BullMQ run orchestration，但缺少统一 journal 与真正可恢复的控制面。

## Scope

- In scope: shared/db contract、context journal、stage input snapshot、run stream、pause/resume/retry/cancel 控制面、final outputs materialization。
- Out of scope: Operator Console UI、team preset UI、execution ledger 账本，这些由后续计划消费本计划的 API 和数据。

## Assumptions

- Drizzle migration 输出目录遵循当前 `packages/db/drizzle.config.ts` 的 `out: "./drizzle"`。
- `ChatCompactionService` 可以通过可选注入写 journal，以兼容现有 isolated unit tests。
- `AgentEventService` 继续保留现有 DB append/idempotency 逻辑，只在 append 成功后增加 in-process stream fan-out。

## Success Criteria

- Run 完成后可读取 `sharedContextJson`、`decisionObjectJson`、`finalReportMarkdown`。
- 每个 stage 可查询输入快照和 lineage。
- SSE stream 与 cursor replay 能输出同一组 run event。
- pause/resume/retry/cancel 不再只是状态字段，而会影响 orchestrator 执行。

## Verification Approach

- 先写 shared contract、journal service、stream controller、report assembler 的失败测试。
- 再实现 API/service 逻辑并运行目标 API tests。
- 最后运行 `pnpm --filter @finsentinel/api typecheck`。

## Progress Log

- 2026-04-17: 初版计划从 OpenAlice gap PRD 拆出 runtime foundation workstream。
- 2026-04-17: 按现有代码修正 Drizzle 输出路径、`payloadJson` 映射、`ContextFabricService` 参数、`ChatCompactionService` optional journal 注入和 `AgentEventService` stream fan-out 位置。
- 2026-04-18: Task 1 and Task 2 completed via context journal contracts, DB schema, journal service, chat compaction writes, run context APIs, and team context wiring.
- 2026-04-18: Task 3 completed via queue-aware `RuntimeControlService`, run stream SSE, aggregate event replay/fan-out, retry-stage endpoint, and orchestrator pause/cancel gates.
- 2026-04-18: Task 4 completed via deterministic `RunReportAssembler`, `completeWithOutputs`, approval completion materialization, and optional orchestrator terminal materialization.
- 2026-04-18 (status sync): repo audit confirmed all four tasks landed. `ContextJournalService` exposes `getRunContext`/`getStageInput` (no `materializeSharedContext` wrapper — `getRunContext` is the materialized entry point, plans that reference `materializeSharedContext` should read `getRunContext`). `AgentEventService.streamAggregate*` + `AnalysisStreamController` are live. Remaining OpenAlice gaps now consolidated in [openalice remaining-work plan](2026-04-18-openalice-remaining-work-plan.md).

## Key Decisions

- Context journal 是运行时上下文的主记录，analysis run 上的 materialized fields 只是读优化。
- Stream 不另建独立事件模型，复用 `agent_events` 并在 API 层映射为前端所需 payload。
- 先保证单进程 SSE 能用；跨实例 pub/sub 可作为后续扩展，不进入本计划。

## Risks And Blockers

- 如果现有 tests 手动实例化 service，新增 constructor dependency 必须可选或同步更新测试工厂。
- BullMQ resume/retry 语义需要和现有 processor 的幂等性一起验证。
- SSE 只用 in-memory fan-out 时，水平扩展下需要后续补 Redis pub/sub 或 event replay fallback。

## Final Outcome

Task 1 through Task 4 have been implemented on the runtime foundation workstream. Remaining follow-up work should move to the operator console, frontend timeline/replay UI, cross-instance stream delivery, and richer final report generation.

## Planned File Map

- Create: `packages/shared/src/schemas/context-journal.ts` — 统一 journal entry、stage input snapshot、lineage contract
- Modify: `packages/shared/src/schemas/analysis.ts` — run response / shared context / stage output 增强
- Modify: `packages/shared/src/schemas/event.ts` — runtime timeline event schema
- Modify: `packages/shared/src/schemas/index.ts` — 导出新 schema
- Create: `packages/shared/src/__tests__/context-journal-schema.test.ts` — shared contract 验证
- Create: `packages/db/src/schema/context-journal-entries.ts` — `context_journal_entries` 表
- Modify: `packages/db/src/schema/index.ts` — 导出新表
- Modify: `packages/db/src/schema/relations.ts` — users / analysis_runs / stages 关系
- Create: `apps/api/src/analysis/context-journal.service.ts` — journal 读写与 context snapshot 物化
- Create: `apps/api/src/analysis/runtime-control.service.ts` — pause / resume / retry / cancel 控制面
- Create: `apps/api/src/analysis/analysis-stream.controller.ts` — run-level SSE stream
- Create: `apps/api/src/analysis/run-report-assembler.service.ts` — final report / decision object / complexity materializer
- Modify: `apps/api/src/analysis/analysis.module.ts` — 注册新服务与导出
- Modify: `apps/api/src/analysis/context-fabric.service.ts` — 从 journal 读取 lineage-aware context
- Modify: `apps/api/src/chat/chat-compaction.service.ts` — 写入 `COMPACTION_BOUNDARY` / `COMPACTION_SUMMARY`
- Modify: `apps/api/src/analysis/analysis-run.service.ts` — 增加物化完成接口
- Modify: `apps/api/src/analysis/analysis-run.controller.ts` — 增加 `/context`、`/stages/:stageKey/input`、`/stream`
- Modify: `apps/api/src/analysis/run-orchestrator.service.ts` — pause/cancel gating、resume 语义、final assembly
- Modify: `apps/api/src/events/agent-event.service.ts` — aggregate stream 支持
- Create: `apps/api/src/analysis/__tests__/context-journal.service.spec.ts`
- Create: `apps/api/src/analysis/__tests__/analysis-stream.controller.spec.ts`
- Create: `apps/api/src/analysis/__tests__/run-report-assembler.service.spec.ts`
- Modify: `apps/api/src/chat/__tests__/chat-compaction.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/context-fabric.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-run.service.spec.ts`

### Task 1: Shared Contracts And Database Schema

**Files:**
- Create: `packages/shared/src/schemas/context-journal.ts`
- Modify: `packages/shared/src/schemas/analysis.ts`
- Modify: `packages/shared/src/schemas/event.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/src/__tests__/context-journal-schema.test.ts`
- Create: `packages/db/src/schema/context-journal-entries.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/relations.ts`

- [ ] **Step 1: Write the failing shared-schema test**

```ts
import { describe, expect, it } from 'vitest';
import {
  contextJournalEntrySchema,
  stageInputSnapshotSchema,
  runtimeTimelineEventSchema,
} from '../context-journal';

describe('context journal contracts', () => {
  it('parses a lineage-aware stage input entry', () => {
    const parsed = contextJournalEntrySchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      sessionId: '33333333-3333-3333-3333-333333333333',
      runId: '44444444-4444-4444-4444-444444444444',
      stageKey: 'THESIS',
      roleKey: 'THESIS_LEAD',
      entryType: 'STAGE_INPUT',
      sourceType: 'RUN',
      sourceRef: 'analysis_runs/44444444-4444-4444-4444-444444444444',
      payload: stageInputSnapshotSchema.parse({
        contextEntryIds: ['ctx-1', 'ctx-2'],
        priorStageKeys: ['INTELLIGENCE'],
        evidenceEntryIds: ['rag-1'],
        promptHash: 'abc123',
        tokenBudget: 12000,
        truncationApplied: false,
      }),
      createdAt: new Date().toISOString(),
    });

    expect(parsed.entryType).toBe('STAGE_INPUT');
  });

  it('parses a runtime timeline event', () => {
    const event = runtimeTimelineEventSchema.parse({
      id: '55555555-5555-5555-5555-555555555555',
      seqNo: 101,
      aggregateId: '44444444-4444-4444-4444-444444444444',
      eventType: 'ROLE_COMPLETED',
      payload: { stageKey: 'THESIS', roleKey: 'THESIS_LEAD', durationMs: 8100 },
      createdAt: new Date().toISOString(),
    });

    expect(event.eventType).toBe('ROLE_COMPLETED');
  });
});
```

- [ ] **Step 2: Run the shared test and verify it fails**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/context-journal-schema.test.ts`

Expected: FAIL with module-export errors for `context-journal` symbols.

- [ ] **Step 3: Write the minimal shared and DB schema implementation**

```ts
// packages/shared/src/schemas/context-journal.ts
import { z } from 'zod';
import { analysisStageKeySchema } from './analysis';

export const contextJournalEntryTypeSchema = z.enum([
  'USER_MESSAGE',
  'ASSISTANT_MESSAGE',
  'COMPACTION_BOUNDARY',
  'COMPACTION_SUMMARY',
  'RAG_EVIDENCE',
  'TOOL_CALL',
  'TOOL_RESULT',
  'STAGE_INPUT',
  'STAGE_OUTPUT',
  'RUN_UPGRADE_LINK',
  'NOTIFICATION',
]);

export const stageInputSnapshotSchema = z.object({
  contextEntryIds: z.array(z.string()),
  priorStageKeys: z.array(analysisStageKeySchema),
  evidenceEntryIds: z.array(z.string()),
  promptHash: z.string(),
  tokenBudget: z.number().int().nonnegative(),
  truncationApplied: z.boolean(),
});

export const contextJournalEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  stageKey: analysisStageKeySchema.nullable(),
  roleKey: z.string().nullable(),
  entryType: contextJournalEntryTypeSchema,
  sourceType: z.string(),
  sourceRef: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const runtimeTimelineEventSchema = z.object({
  id: z.string().uuid(),
  seqNo: z.number().int(),
  aggregateId: z.string().uuid(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
```

```ts
// packages/db/src/schema/context-journal-entries.ts
import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { analysisRuns } from './analysis-runs';

export const contextJournalEntries = pgTable('context_journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  sessionId: uuid('session_id'),
  runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'cascade' }),
  stageKey: varchar('stage_key', { length: 32 }),
  roleKey: varchar('role_key', { length: 64 }),
  entryType: varchar('entry_type', { length: 40 }).notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  sourceRef: varchar('source_ref', { length: 255 }),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_context_journal_run_created').on(table.runId, table.createdAt.desc()),
  index('idx_context_journal_session_created').on(table.sessionId, table.createdAt.desc()),
  index('idx_context_journal_stage_created').on(table.runId, table.stageKey, table.createdAt.desc()),
]);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @finsentinel/db db:generate`

Expected: a new SQL migration appears under `packages/db/drizzle/`, because `packages/db/drizzle.config.ts` sets `out: "./drizzle"`.

- [ ] **Step 5: Re-run the shared test and DB typecheck**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/context-journal-schema.test.ts`

Expected: PASS with `2 passed`.

Run: `pnpm --filter @finsentinel/db typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/context-journal.ts packages/shared/src/schemas/analysis.ts packages/shared/src/schemas/event.ts packages/shared/src/schemas/index.ts packages/shared/src/__tests__/context-journal-schema.test.ts packages/db/src/schema/context-journal-entries.ts packages/db/src/schema/index.ts packages/db/src/schema/relations.ts packages/db/drizzle
git commit -m "feat: add runtime context journal contracts"
```

### Task 2: Context Journal Service And Context Read APIs

**Files:**
- Create: `apps/api/src/analysis/context-journal.service.ts`
- Modify: `apps/api/src/analysis/analysis.module.ts`
- Modify: `apps/api/src/chat/chat-compaction.service.ts`
- Modify: `apps/api/src/analysis/context-fabric.service.ts`
- Modify: `apps/api/src/analysis/analysis-run.controller.ts`
- Create: `apps/api/src/analysis/__tests__/context-journal.service.spec.ts`
- Modify: `apps/api/src/chat/__tests__/chat-compaction.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/context-fabric.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts`

- [ ] **Step 1: Write the failing API/service tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ContextJournalService } from '../context-journal.service';

describe('ContextJournalService', () => {
  it('writes stage input snapshots and builds lineage-aware shared context', async () => {
    const insertChain = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: 'journal-1' }]) };
    const db = { insert: vi.fn().mockReturnValue(insertChain), select: vi.fn() } as never;
    const service = new ContextJournalService(db);

    await service.appendStageInput({
      userId: '11111111-1111-1111-1111-111111111111',
      runId: '22222222-2222-2222-2222-222222222222',
      stageKey: 'THESIS',
      roleKey: 'THESIS_LEAD',
      payload: {
        contextEntryIds: ['ctx-1'],
        priorStageKeys: ['INTELLIGENCE'],
        evidenceEntryIds: ['rag-1'],
        promptHash: 'hash-1',
        tokenBudget: 12000,
        truncationApplied: false,
      },
    });

    expect(db.insert).toHaveBeenCalled();
  });
});
```

```ts
it('GET /analysis/runs/:id/context returns the materialized context snapshot', async () => {
  const result = await controller.getContext(runId, mockUser);
  expect(result.shortTermSessionContext.lineage.length).toBe(1);
});
```

- [ ] **Step 2: Run the targeted API tests and verify they fail**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/context-journal.service.spec.ts src/analysis/__tests__/analysis-run.controller.spec.ts src/chat/__tests__/chat-compaction.service.spec.ts src/analysis/__tests__/context-fabric.service.spec.ts`

Expected: FAIL with missing provider / missing controller methods.

- [ ] **Step 3: Implement the journal service and wire compaction + fabric**

```ts
// apps/api/src/analysis/context-journal.service.ts
@Injectable()
export class ContextJournalService {
  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  async appendCompactionSummary(args: {
    userId: string;
    sessionId: string;
    payload: { summaryText: string; compactedMessageCount: number };
  }): Promise<void> {
    await this.append({
      userId: args.userId,
      sessionId: args.sessionId,
      entryType: 'COMPACTION_SUMMARY',
      sourceType: 'CHAT',
      sourceRef: `chat_session_memories/${args.sessionId}`,
      payload: args.payload,
    });
  }

  async appendStageInput(args: {
    userId: string;
    runId: string;
    stageKey: AnalysisStageKey;
    roleKey: string | null;
    payload: z.infer<typeof stageInputSnapshotSchema>;
  }): Promise<void> {
    await this.append({
      userId: args.userId,
      runId: args.runId,
      stageKey: args.stageKey,
      roleKey: args.roleKey,
      entryType: 'STAGE_INPUT',
      sourceType: 'RUN',
      sourceRef: `analysis_runs/${args.runId}`,
      payload: args.payload,
    });
  }
}
```

```ts
// apps/api/src/chat/chat-compaction.service.ts
// ChatModule already imports AnalysisModule via forwardRef. Register
// ContextJournalService as an exported AnalysisModule provider, then inject it
// into ChatCompactionService with @Optional() so existing isolated unit tests
// can still construct the service before they add the mock provider.
await this.contextJournal?.append({
  userId,
  sessionId,
  entryType: 'COMPACTION_BOUNDARY',
  sourceType: 'CHAT',
  sourceRef: `chat_messages/${sessionId}`,
  payload: { threshold: this.threshold, recentWindow: this.recentWindow, compactedCount: oldMessages.length },
});
await this.contextJournal?.appendCompactionSummary({
  userId,
  sessionId,
  payload: { summaryText: summary, compactedMessageCount: oldMessages.length },
});
```

```ts
// apps/api/src/analysis/context-fabric.service.ts
interface AssembleArgs {
  userId: string;
  runId?: string;
  sessionId?: string;
  prompt: string;
  portfolioId?: string;
}

const shared = await this.contextJournal.materializeSharedContext({
  userId: args.userId,
  runId: args.runId,
  sessionId: args.sessionId,
  prompt: args.prompt,
  portfolioId: args.portfolioId,
});
return shared;
```

- [ ] **Step 4: Add the context read endpoints**

```ts
// apps/api/src/analysis/analysis-run.controller.ts
@Get(':id/context')
async getContext(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
  return this.contextJournal.getRunContext(user.userId, id);
}

@Get(':id/stages/:stageKey/input')
async getStageInput(
  @Param('id', new ParseUUIDPipe()) id: string,
  @Param('stageKey') stageKey: AnalysisStageKey,
  @CurrentUser() user: CurrentUserPayload,
) {
  return this.contextJournal.getStageInput(user.userId, id, stageKey);
}
```

- [ ] **Step 5: Re-run the API tests and typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/context-journal.service.spec.ts src/analysis/__tests__/analysis-run.controller.spec.ts src/chat/__tests__/chat-compaction.service.spec.ts src/analysis/__tests__/context-fabric.service.spec.ts`

Expected: PASS with all targeted tests green.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analysis/context-journal.service.ts apps/api/src/analysis/analysis.module.ts apps/api/src/chat/chat-compaction.service.ts apps/api/src/analysis/context-fabric.service.ts apps/api/src/analysis/analysis-run.controller.ts apps/api/src/analysis/__tests__/context-journal.service.spec.ts apps/api/src/chat/__tests__/chat-compaction.service.spec.ts apps/api/src/analysis/__tests__/context-fabric.service.spec.ts apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts
git commit -m "feat: wire context journal into chat and analysis"
```

### Task 3: Runtime Control Service And Live Stream

**Files:**
- Create: `apps/api/src/analysis/runtime-control.service.ts`
- Create: `apps/api/src/analysis/analysis-stream.controller.ts`
- Modify: `apps/api/src/events/agent-event.service.ts`
- Modify: `apps/api/src/analysis/analysis.module.ts`
- Modify: `apps/api/src/analysis/analysis-run.controller.ts`
- Modify: `apps/api/src/analysis/analysis-run.service.ts`
- Modify: `apps/api/src/analysis/run-orchestrator.service.ts`
- Create: `apps/api/src/analysis/__tests__/analysis-stream.controller.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-run.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts`

- [ ] **Step 1: Write the failing control-plane tests**

```ts
it('POST /analysis/runs/:id/resume re-enqueues the run', async () => {
  await controller.resume(runId, mockUser);
  expect(producer.enqueueResume).toHaveBeenCalledWith({ runId, userId: mockUser.userId });
});

it('orchestrator does not start a paused stage job', async () => {
  mockRuns.getForUser.mockResolvedValue({ id: runId, status: 'PAUSED', currentStageKey: 'THESIS' });
  await orchestrator.step({ runId, userId, stepKind: 'EXECUTE_STAGE', stageKey: 'THESIS' });
  expect(mockExecutor).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the control tests and verify they fail**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/analysis-run.controller.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts src/analysis/__tests__/analysis-stream.controller.spec.ts`

Expected: FAIL because `resume()` does not enqueue and no stream controller exists.

- [ ] **Step 3: Implement the control service, stream fan-out, and orchestrator gating**

```ts
// apps/api/src/analysis/runtime-control.service.ts
@Injectable()
export class RuntimeControlService {
  constructor(
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
  ) {}

  async resume(userId: string, runId: string): Promise<void> {
    await this.runs.resume(userId, runId);
    await this.producer.enqueueResume({ userId, runId });
  }
}
```

```ts
// apps/api/src/events/agent-event.service.ts
private readonly stream$ = new Subject<AgentEventResponse>();

async append(
  userId: string,
  aggregateType: AgentEventAggregateType,
  aggregateId: string | null,
  eventType: AgentEventType,
  payload: Record<string, unknown> | null,
  idempotencyKey: string | null,
) {
  // Keep the existing idempotency branch; add this fan-out after the insert returns.
  const [created] = await this.db.insert(agentEvents).values({
    userId,
    aggregateType,
    aggregateId: aggregateId ?? undefined,
    eventType,
    payloadJson: payload ?? {},
    idempotencyKey: idempotencyKey ?? undefined,
  }).returning();
  this.stream$.next({
    id: created.id,
    seqNo: created.seqNo,
    userId: created.userId,
    aggregateType: created.aggregateType,
    aggregateId: created.aggregateId!,
    eventType: created.eventType,
    payload: created.payloadJson,
    createdAt: created.createdAt.toISOString(),
  });
  return created;
}

streamAggregate(userId: string, aggregateId: string) {
  return this.stream$.pipe(filter((event) => event.userId === userId && event.aggregateId === aggregateId));
}
```

```ts
// apps/api/src/analysis/run-orchestrator.service.ts
const run = await this.runs.getForUser(data.userId, data.runId);
if (!run || run.status === 'PAUSED' || run.status === 'CANCELED') {
  return;
}
```

- [ ] **Step 4: Add the SSE endpoint**

```ts
// apps/api/src/analysis/analysis-stream.controller.ts
@Controller('analysis/runs')
@UseGuards(JwtGuard)
export class AnalysisStreamController {
  constructor(private readonly events: AgentEventService) {}

  @Sse(':id/stream')
  stream(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.events.streamAggregate(user.userId, id).pipe(
      map((event) => ({ data: event })),
    );
  }
}
```

- [ ] **Step 5: Re-run tests and a focused typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/analysis-run.controller.spec.ts src/analysis/__tests__/analysis-run.service.spec.ts src/analysis/__tests__/analysis-stream.controller.spec.ts`

Expected: PASS with control-plane tests green.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analysis/runtime-control.service.ts apps/api/src/analysis/analysis-stream.controller.ts apps/api/src/events/agent-event.service.ts apps/api/src/analysis/analysis.module.ts apps/api/src/analysis/analysis-run.controller.ts apps/api/src/analysis/analysis-run.service.ts apps/api/src/analysis/run-orchestrator.service.ts apps/api/src/analysis/__tests__/analysis-stream.controller.spec.ts apps/api/src/analysis/__tests__/analysis-run.service.spec.ts apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts
git commit -m "fix: close runtime control loop and add analysis stream"
```

### Task 4: Materialize Run Outputs On Completion

**Files:**
- Create: `apps/api/src/analysis/run-report-assembler.service.ts`
- Modify: `apps/api/src/analysis/analysis-run.service.ts`
- Modify: `apps/api/src/analysis/analysis-checkpoint.service.ts`
- Modify: `apps/api/src/analysis/run-orchestrator.service.ts`
- Create: `apps/api/src/analysis/__tests__/run-report-assembler.service.spec.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

- [ ] **Step 1: Write the failing materialization test**

```ts
import { describe, expect, it } from 'vitest';
import { RunReportAssembler } from '../run-report-assembler.service';

describe('RunReportAssembler', () => {
  it('builds finalReportMarkdown and decisionObject from stage outputs', async () => {
    const assembler = new RunReportAssembler();
    const result = assembler.build({
      sharedContext: {
        longTermPreferenceContext: { summary: 'risk aware', sourceIds: [], updatedAt: new Date().toISOString() },
        midTermStrategyContext: { summary: 'swing trading', sourceIds: [], updatedAt: new Date().toISOString() },
        shortTermSessionContext: { summary: 'chat summary', sourceIds: [], updatedAt: new Date().toISOString() },
        retrievalContext: { summary: 'earnings beat', sourceIds: ['news-1'], updatedAt: new Date().toISOString() },
      },
      stages: [
        { stageKey: 'RISK', humanReportMarkdown: 'risk ok', structuredOutput: { portfolioDecision: 'BUY', allocationGuidance: { notes: 'scale in', targets: [] }, riskLimits: { maxDrawdownPct: 8, stopLossTriggers: [] }, alertTriggers: [], summary: 'risk ok', thesis: 'buy', risks: [], openQuestions: [], citations: [], confidence: 0.72 } },
        { stageKey: 'EXECUTION_PREP', humanReportMarkdown: 'drafts ready', structuredOutput: { orderDraftCount: 1, orderDraftsArtifactId: 'artifact-order-drafts' } },
      ],
      executionPayload: {
        orderDrafts: [],
      },
    });

    expect(result.finalReportMarkdown).toContain('risk ok');
    expect(result.decisionObject?.portfolioDecision).toBe('BUY');
  });
});
```

- [ ] **Step 2: Run the materialization tests and verify they fail**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/run-report-assembler.service.spec.ts src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

Expected: FAIL because no assembler exists and completion does not persist outputs.

- [ ] **Step 3: Implement the assembler and completion path**

```ts
// apps/api/src/analysis/run-report-assembler.service.ts
@Injectable()
export class RunReportAssembler {
  build(args: {
    sharedContext: SharedContext | null;
    stages: Array<{ stageKey: AnalysisStageKey; humanReportMarkdown: string | null; structuredOutput: Record<string, unknown> | null }>;
    executionPayload: Record<string, unknown> | null;
  }): {
    finalReportMarkdown: string;
    decisionObject: DecisionObject | null;
  } {
    const sections = args.stages
      .filter((stage) => stage.humanReportMarkdown)
      .map((stage) => `## ${stage.stageKey}\n\n${stage.humanReportMarkdown}`);
    const riskStage = args.stages.find((stage) => stage.stageKey === 'RISK');
    const risk = (riskStage?.structuredOutput ?? {}) as Record<string, unknown>;
    const candidate = {
      portfolioDecision: String(risk.portfolioDecision ?? 'HOLD'),
      allocationGuidance: risk.allocationGuidance ?? { notes: '', targets: [] },
      riskLimits: risk.riskLimits ?? { maxDrawdownPct: 10, stopLossTriggers: [] },
      alertTriggers: risk.alertTriggers ?? [],
      confidence: Number(risk.confidence ?? 0),
      evidenceRefs: [],
      executionPayload: args.executionPayload ?? { orderDrafts: [] },
      alertPayload: { alerts: [] },
      strategyArchivePayload: { snapshot: {} },
    };
    const decisionObject = decisionObjectSchema.safeParse(candidate).success
      ? decisionObjectSchema.parse(candidate)
      : null;
    return {
      finalReportMarkdown: ['# Final Analysis Report', ...sections].join('\n\n'),
      decisionObject,
    };
  }
}
```

```ts
// apps/api/src/analysis/analysis-run.service.ts
async completeWithOutputs(args: {
  userId: string;
  runId: string;
  sharedContext: SharedContext | null;
  decisionObject: DecisionObject | null;
  finalReportMarkdown: string;
}) {
  await this.db.update(analysisRuns).set({
    status: 'COMPLETED',
    sharedContextJson: args.sharedContext,
    decisionObjectJson: args.decisionObject,
    finalReportMarkdown: args.finalReportMarkdown,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(analysisRuns.id, args.runId), eq(analysisRuns.userId, args.userId)));
}
```

- [ ] **Step 4: Call the assembler from the orchestrator’s terminal path**

```ts
// apps/api/src/analysis/run-orchestrator.service.ts
if (next === null) {
  const sharedContext = await this.contextJournal.getRunContext(data.userId, data.runId);
  const stages = await this.runs.listStagesForRun(data.runId);
  const artifacts = await this.runs.listArtifactsForRun(data.runId);
  const executionArtifact = artifacts.find((artifact) => artifact.artifactKind === 'EXECUTION_PAYLOAD');
  const executionPayload = executionArtifact?.payloadJson ?? null;
  const assembled = this.reportAssembler.build({
    sharedContext,
    stages: stages.map((stage) => ({
      stageKey: stage.stageKey,
      humanReportMarkdown: stage.humanReportMarkdown,
      structuredOutput: stage.structuredOutputJson,
    })),
    executionPayload,
  });
  await this.runs.completeWithOutputs({
    userId: data.userId,
    runId: data.runId,
    sharedContext,
    decisionObject: assembled.decisionObject,
    finalReportMarkdown: assembled.finalReportMarkdown,
  });
}
```

- [ ] **Step 5: Re-run tests and the API typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/run-report-assembler.service.spec.ts src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

Expected: PASS with targeted materialization tests green.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analysis/run-report-assembler.service.ts apps/api/src/analysis/analysis-run.service.ts apps/api/src/analysis/analysis-checkpoint.service.ts apps/api/src/analysis/run-orchestrator.service.ts apps/api/src/analysis/__tests__/run-report-assembler.service.spec.ts apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts
git commit -m "feat: materialize run outputs on completion"
```

## Self-Review

### Spec Coverage

- `Context Journal`：Task 1, Task 2
- `COMPACTION_BOUNDARY / COMPACTION_SUMMARY`：Task 2
- `GET /analysis/runs/:id/context`：Task 2
- `GET /analysis/runs/:id/stages/:stageKey/input`：Task 2
- `pause / resume / stream / replay cursor 基础`：Task 3
- `sharedContextJson / decisionObjectJson / finalReportMarkdown`：Task 4

### Placeholder Scan

未保留空占位、延后实现或复用上文的模糊写法；每个代码步骤都给了具体文件和代码块。

### Type Consistency

- `ContextJournalService`
- `RuntimeControlService`
- `RunReportAssembler`
- `contextJournalEntrySchema`
- `runtimeTimelineEventSchema`

以上命名在本计划内保持一致，供后续 Operator Console 和 Execution Ledger 计划复用。
