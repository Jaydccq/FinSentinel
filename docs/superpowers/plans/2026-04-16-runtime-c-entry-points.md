# Plan C — Entry-Point Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the three live entry points (chat, schedule-driven autonomy, heartbeat) into the unified runtime from Plan A+B. Chat auto-upgrades to a tracked run when the preflight planner crosses v1 thresholds. Schedules stop being CRUD-only and actually enqueue runs. Heartbeat runs tick and fire analyses on configured triggers.

**Architecture:** A new `ChatUpgradePlannerService` wraps `PreflightPlannerService` + `AnalysisRunService` so `ChatService` can request an upgrade with one call and get back a `runId + upgradeReason`. A new `AnalysisRuntimeTriggerService` inside `autonomy/` is the single path by which schedules and heartbeats enqueue runs — it never touches the BullMQ queue directly. A new `ScheduleRuntimeService` wraps `@nestjs/schedule` to tick pending schedules; a new `HeartbeatRuntimeService` ticks on configurable intervals. Both go through `AnalysisRuntimeTriggerService`. Feature flags gate everything.

**Tech Stack:** NestJS, `@nestjs/schedule`, `cron-parser`, Zod, Vitest.

**Depends on:** Plan A, Plan B.
**Unblocks:** Plan D.

---

## File Structure

### New files

```
apps/api/src/chat/chat-upgrade-planner.service.ts
apps/api/src/chat/__tests__/chat-upgrade-planner.service.spec.ts

apps/api/src/autonomy/analysis-runtime-trigger.service.ts
apps/api/src/autonomy/schedule-runtime.service.ts
apps/api/src/autonomy/heartbeat-runtime.service.ts
apps/api/src/autonomy/__tests__/analysis-runtime-trigger.service.spec.ts
apps/api/src/autonomy/__tests__/schedule-runtime.service.spec.ts
apps/api/src/autonomy/__tests__/heartbeat-runtime.service.spec.ts
```

### Modified files

```
apps/api/src/chat/chat.service.ts                  # Call planner before streaming; emit CHAT_AUTO_UPGRADED event
apps/api/src/chat/chat.controller.ts               # Expose runId + upgradeReason on stream response
apps/api/src/chat/chat.module.ts                   # Register ChatUpgradePlannerService, import AnalysisModule
apps/api/src/autonomy/autonomy.module.ts           # Register new runtime services + @nestjs/schedule root
apps/api/src/autonomy/schedule.service.ts          # Set nextRunAt on create/update via cron-parser
apps/api/src/app.module.ts                         # Ensure ScheduleModule.forRoot() imported once

apps/api/src/analysis/analysis-approval.service.ts # After APPROVE, optionally dispatch to UnifiedTradingService when AUTO_DISPATCH flag on
apps/api/src/config/env.validation.ts              # Add APPROVAL_AUTO_DISPATCH_ENABLED
```

Each entry point is thin: the chat path computes a single boolean, the schedule path walks `enabled=true` rows where `nextRunAt <= now`, and the heartbeat path is a single interval tick. All three end at `AnalysisRuntimeTriggerService.trigger({ userId, sourceMode, prompt })`.

---

## Task 1: ChatUpgradePlannerService

Decides whether a chat request should spawn an `analysis_run`, and if so creates it + enqueues preflight.

**Files:**
- Create: `apps/api/src/chat/chat-upgrade-planner.service.ts`
- Create: `apps/api/src/chat/__tests__/chat-upgrade-planner.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/chat/__tests__/chat-upgrade-planner.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatUpgradePlannerService } from '../chat-upgrade-planner.service';

describe('ChatUpgradePlannerService.maybeUpgrade', () => {
  let preflight: { decide: ReturnType<typeof vi.fn> };
  let runs: { createQueued: ReturnType<typeof vi.fn> };
  let producer: { enqueuePreflight: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: ChatUpgradePlannerService;

  beforeEach(() => {
    preflight = {
      decide: vi.fn(),
    };
    runs = {
      createQueued: vi
        .fn()
        .mockResolvedValue({ id: 'run-1', userId: 'u1', status: 'QUEUED' }),
    };
    producer = { enqueuePreflight: vi.fn().mockResolvedValue(undefined) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new ChatUpgradePlannerService(
      preflight as never,
      runs as never,
      producer as never,
      events as never,
      { enabled: true },
    );
  });

  it('does NOT upgrade when preflight reports below-threshold', async () => {
    preflight.decide.mockResolvedValue({
      predictedToolCalls: 2,
      predictedToolRounds: 1,
      predictedWallClockSec: 5,
      upgradeRecommended: false,
      upgradeReason: 'below-threshold',
    });
    const result = await svc.maybeUpgrade({
      userId: 'u1',
      sessionId: 's1',
      prompt: 'hi',
    });
    expect(result.upgraded).toBe(false);
    expect(runs.createQueued).not.toHaveBeenCalled();
  });

  it('upgrades when preflight recommends + enqueues + emits CHAT_AUTO_UPGRADED', async () => {
    preflight.decide.mockResolvedValue({
      predictedToolCalls: 8,
      predictedToolRounds: 4,
      predictedWallClockSec: 30,
      upgradeRecommended: true,
      upgradeReason: 'intent:complete analysis',
    });
    const result = await svc.maybeUpgrade({
      userId: 'u1',
      sessionId: 's1',
      prompt: 'complete analysis of AAPL',
    });
    expect(result.upgraded).toBe(true);
    expect(result.runId).toBe('run-1');
    expect(result.upgradeReason).toContain('intent');
    expect(runs.createQueued).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ sourceMode: 'CHAT', parentChatSessionId: 's1' }),
    );
    expect(producer.enqueuePreflight).toHaveBeenCalledWith({
      runId: 'run-1',
      userId: 'u1',
    });
  });

  it('respects the feature flag off', async () => {
    svc = new ChatUpgradePlannerService(
      preflight as never,
      runs as never,
      producer as never,
      events as never,
      { enabled: false },
    );
    preflight.decide.mockResolvedValue({
      predictedToolCalls: 99,
      predictedToolRounds: 99,
      predictedWallClockSec: 99,
      upgradeRecommended: true,
      upgradeReason: 'x',
    });
    const result = await svc.maybeUpgrade({ userId: 'u1', sessionId: 's1', prompt: 'x' });
    expect(result.upgraded).toBe(false);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- chat-upgrade-planner`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/chat/chat-upgrade-planner.service.ts`:

```ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisRunSourceMode,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';
import { AnalysisRunService } from '../analysis/analysis-run.service';
import { PreflightPlannerService } from '../analysis/preflight-planner.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';

export interface UpgradeResult {
  upgraded: boolean;
  runId?: string;
  upgradeReason?: string;
  predictedToolCalls?: number;
}

@Injectable()
export class ChatUpgradePlannerService {
  private readonly logger = new Logger(ChatUpgradePlannerService.name);

  constructor(
    private readonly planner: PreflightPlannerService,
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
    private readonly events: AgentEventService,
    @Inject('CHAT_UPGRADE_FLAG') private readonly flag: { enabled: boolean },
  ) {}

  async maybeUpgrade(args: {
    userId: string;
    sessionId?: string;
    prompt: string;
  }): Promise<UpgradeResult> {
    if (!this.flag.enabled) return { upgraded: false };

    const estimate = await this.planner.decide({ prompt: args.prompt });
    if (!estimate.upgradeRecommended) return { upgraded: false };

    const sourceMode: AnalysisRunSourceMode = 'CHAT';
    const run = await this.runs.createQueued(args.userId, {
      prompt: args.prompt,
      sourceMode,
      parentChatSessionId: args.sessionId,
    });
    await this.producer.enqueuePreflight({ runId: run.id, userId: args.userId });
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      run.id,
      AgentEventType.CHAT_AUTO_UPGRADED,
      {
        sessionId: args.sessionId,
        predictedToolCalls: estimate.predictedToolCalls,
        predictedToolRounds: estimate.predictedToolRounds,
        predictedWallClockSec: estimate.predictedWallClockSec,
        upgradeReason: estimate.upgradeReason,
      },
      null,
    );
    this.logger.log(
      `Chat auto-upgraded for user ${args.userId}: run=${run.id} reason=${estimate.upgradeReason}`,
    );
    return {
      upgraded: true,
      runId: run.id,
      upgradeReason: estimate.upgradeReason,
      predictedToolCalls: estimate.predictedToolCalls,
    };
  }
}

export const chatUpgradeFlagProvider = {
  provide: 'CHAT_UPGRADE_FLAG',
  useFactory: (config: ConfigService) => ({
    enabled: config.get<boolean>('CHAT_AUTO_UPGRADE_ENABLED', false),
  }),
  inject: [ConfigService],
};
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- chat-upgrade-planner`
Expected: PASS.

```bash
git add apps/api/src/chat/chat-upgrade-planner.service.ts \
        apps/api/src/chat/__tests__/chat-upgrade-planner.service.spec.ts
git commit -m "feat(chat): ChatUpgradePlannerService gated by CHAT_AUTO_UPGRADE_ENABLED"
```

---

## Task 2: Wire ChatUpgradePlanner into ChatService

**Files:**
- Modify: `apps/api/src/chat/chat.service.ts`
- Modify: `apps/api/src/chat/chat.module.ts`
- Modify: `apps/api/src/chat/chat.controller.ts`

- [ ] **Step 1: Register in ChatModule**

Edit `apps/api/src/chat/chat.module.ts`:

```ts
import { AnalysisModule } from '../analysis/analysis.module';
import { QueueModule } from '../queue/queue.module';
import { EventsModule } from '../events/events.module';
import {
  ChatUpgradePlannerService,
  chatUpgradeFlagProvider,
} from './chat-upgrade-planner.service';

@Module({
  imports: [
    AgentModule,
    CommonModule,
    AuthModule,
    PortfolioModule,
    AnalysisModule,
    QueueModule,
    EventsModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatCompactionService,
    ChatService,
    ChatUpgradePlannerService,
    chatUpgradeFlagProvider,
  ],
  exports: [ChatCompactionService, ChatService],
})
export class ChatModule {}
```

- [ ] **Step 2: Extend ChatService.streamChat**

Edit `apps/api/src/chat/chat.service.ts`. Inject `ChatUpgradePlannerService`. Before calling `agentService.streamChat`, consult the planner. If upgraded, return a dedicated SSE stream that emits a short `Open Run` message with the `runId`, plus terminate the stream.

Change the constructor:

```ts
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly agentService: AgentService,
    private readonly chatCompactionService: ChatCompactionService,
    private readonly portfolioService: PortfolioService,
    private readonly upgradePlanner: ChatUpgradePlannerService,
  ) {}
```

Update `streamChat`:

```ts
  async streamChat(
    message: string,
    userId: string,
    sessionId?: string,
    portfolioId?: string,
  ): Promise<{
    sessionId: string;
    stream: ReadableStream<Uint8Array>;
    runId?: string;
    upgradeReason?: string;
  }> {
    const resolvedSessionId = sessionId ?? randomUUID();

    // Auto-upgrade gate. If the planner decides to spawn a run, return a
    // short-circuit stream that tells the client to open the workspace.
    const upgrade = await this.upgradePlanner.maybeUpgrade({
      userId,
      sessionId: resolvedSessionId,
      prompt: message,
    });
    if (upgrade.upgraded && upgrade.runId) {
      await this.persistMessage(userId, resolvedSessionId, 'user', message);
      const summary =
        `This request was upgraded to a tracked analysis run (${upgrade.upgradeReason ?? 'auto'}). ` +
        `Open Run ${upgrade.runId} to follow progress.`;
      await this.persistMessage(userId, resolvedSessionId, 'assistant', summary);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const payload = {
            content: summary,
            sessionId: resolvedSessionId,
            runId: upgrade.runId,
            upgradeReason: upgrade.upgradeReason,
          };
          controller.enqueue(
            encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`),
          );
          controller.enqueue(encoder.encode('event: done\ndata: [DONE]\n\n'));
          controller.close();
        },
      });
      return { sessionId: resolvedSessionId, stream, runId: upgrade.runId, upgradeReason: upgrade.upgradeReason };
    }

    // Normal chat path (unchanged)
    const history = await this.getHistoryRows(userId, resolvedSessionId);
    const augmentedMessage = await this.chatCompactionService.augmentPrompt(
      userId,
      resolvedSessionId,
      message,
    );
    await this.persistMessage(userId, resolvedSessionId, 'user', message);
    const sseStream = await this.agentService.streamChat(
      augmentedMessage,
      userId,
      [
        ...history.map((row) => ({ role: row.role, content: row.content })),
        { role: 'user', content: augmentedMessage },
      ],
      resolvedSessionId,
      portfolioId,
    );
    return {
      sessionId: resolvedSessionId,
      stream: this.wrapAssistantPersistence(sseStream, userId, resolvedSessionId),
    };
  }
```

Don't forget the new import:

```ts
import { ChatUpgradePlannerService } from './chat-upgrade-planner.service';
```

- [ ] **Step 3: Surface runId + upgradeReason on the HTTP response headers (or body)**

Edit `apps/api/src/chat/chat.controller.ts`. Read the existing `streamChat` endpoint and wherever it sets response headers, add:

```ts
    if (result.runId) {
      res.setHeader('X-Analysis-Run-Id', result.runId);
    }
    if (result.upgradeReason) {
      res.setHeader('X-Analysis-Upgrade-Reason', result.upgradeReason);
    }
```

(Do this after the existing SSE content-type headers so headers go out in the same response.)

- [ ] **Step 4: Run full chat test + commit**

Run: `pnpm --filter @finsentinel/api test -- chat.service chat.controller chat-upgrade-planner`
Expected: PASS.

```bash
git add apps/api/src/chat/chat.service.ts \
        apps/api/src/chat/chat.module.ts \
        apps/api/src/chat/chat.controller.ts
git commit -m "feat(chat): route streamChat through ChatUpgradePlannerService"
```

---

## Task 3: AnalysisRuntimeTriggerService

One-stop path for schedule and heartbeat to enqueue runs. Matches the shape `ChatUpgradePlannerService` takes but for non-chat sources.

**Files:**
- Create: `apps/api/src/autonomy/analysis-runtime-trigger.service.ts`
- Create: `apps/api/src/autonomy/__tests__/analysis-runtime-trigger.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/autonomy/__tests__/analysis-runtime-trigger.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalysisRuntimeTriggerService } from '../analysis-runtime-trigger.service';

describe('AnalysisRuntimeTriggerService.trigger', () => {
  let runs: { createQueued: ReturnType<typeof vi.fn> };
  let producer: { enqueuePreflight: ReturnType<typeof vi.fn> };
  let svc: AnalysisRuntimeTriggerService;

  beforeEach(() => {
    runs = {
      createQueued: vi.fn().mockResolvedValue({ id: 'run-9', userId: 'u1' }),
    };
    producer = { enqueuePreflight: vi.fn().mockResolvedValue(undefined) };
    svc = new AnalysisRuntimeTriggerService(runs as never, producer as never);
  });

  it('schedule source persists with sourceMode=SCHEDULE and enqueues preflight', async () => {
    const out = await svc.trigger({
      userId: 'u1',
      sourceMode: 'SCHEDULE',
      prompt: 'daily risk check',
      payload: { scheduleId: 'sched-1' },
    });
    expect(out.runId).toBe('run-9');
    expect(runs.createQueued).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ sourceMode: 'SCHEDULE', prompt: 'daily risk check' }),
    );
    expect(producer.enqueuePreflight).toHaveBeenCalledWith({ runId: 'run-9', userId: 'u1' });
  });

  it('heartbeat source persists with sourceMode=HEARTBEAT', async () => {
    await svc.trigger({
      userId: 'u1',
      sourceMode: 'HEARTBEAT',
      prompt: 'drawdown check',
    });
    expect(runs.createQueued).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ sourceMode: 'HEARTBEAT' }),
    );
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- analysis-runtime-trigger`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/autonomy/analysis-runtime-trigger.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { AnalysisRunSourceMode } from '@finsentinel/shared';
import { AnalysisRunService } from '../analysis/analysis-run.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';

interface TriggerArgs {
  userId: string;
  sourceMode: AnalysisRunSourceMode;
  prompt: string;
  ticker?: string;
  portfolioId?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AnalysisRuntimeTriggerService {
  constructor(
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
  ) {}

  async trigger(args: TriggerArgs): Promise<{ runId: string }> {
    const run = await this.runs.createQueued(args.userId, {
      prompt: args.prompt,
      sourceMode: args.sourceMode,
      ticker: args.ticker,
      portfolioId: args.portfolioId,
    });
    await this.producer.enqueuePreflight({ runId: run.id, userId: args.userId });
    return { runId: run.id };
  }
}
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- analysis-runtime-trigger`
Expected: PASS.

```bash
git add apps/api/src/autonomy/analysis-runtime-trigger.service.ts \
        apps/api/src/autonomy/__tests__/analysis-runtime-trigger.service.spec.ts
git commit -m "feat(autonomy): AnalysisRuntimeTriggerService unifies schedule/heartbeat entry"
```

---

## Task 4: ScheduleRuntimeService

Ticks every minute. Pulls rows where `enabled = true AND nextRunAt <= now()`, triggers the runtime for each, updates `lastRunAt` and recomputes `nextRunAt` via `cron-parser`.

**Files:**
- Create: `apps/api/src/autonomy/schedule-runtime.service.ts`
- Create: `apps/api/src/autonomy/__tests__/schedule-runtime.service.spec.ts`
- Modify: `apps/api/src/autonomy/schedule.service.ts` (set nextRunAt on create/update)

- [ ] **Step 1: Install cron-parser if missing**

Run: `cd apps/api && pnpm list cron-parser`.
If not installed, run: `pnpm --filter @finsentinel/api add cron-parser`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/autonomy/__tests__/schedule-runtime.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleRuntimeService } from '../schedule-runtime.service';

describe('ScheduleRuntimeService.tick', () => {
  let db: {
    listDueSchedules: ReturnType<typeof vi.fn>;
    markScheduleRan: ReturnType<typeof vi.fn>;
  };
  let trigger: { trigger: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: ScheduleRuntimeService;

  beforeEach(() => {
    db = {
      listDueSchedules: vi.fn(),
      markScheduleRan: vi.fn().mockResolvedValue(undefined),
    };
    trigger = { trigger: vi.fn().mockResolvedValue({ runId: 'run-x' }) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new ScheduleRuntimeService(db as never, trigger as never, events as never, {
      enabled: true,
    });
  });

  it('triggers a run for every due schedule and advances nextRunAt', async () => {
    db.listDueSchedules.mockResolvedValue([
      {
        id: 'sch-1',
        userId: 'u1',
        cronExpression: '0 * * * *',
        taskType: 'PORTFOLIO_REVIEW',
        taskPayload: { portfolioId: 'p1' },
      },
    ]);
    await svc.tick();
    expect(trigger.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sourceMode: 'SCHEDULE' }),
    );
    expect(db.markScheduleRan).toHaveBeenCalledWith(
      'sch-1',
      expect.any(Date), // lastRunAt
      expect.any(Date), // nextRunAt
    );
    expect(events.append).toHaveBeenCalled();
  });

  it('is a no-op when disabled', async () => {
    svc = new ScheduleRuntimeService(db as never, trigger as never, events as never, {
      enabled: false,
    });
    db.listDueSchedules.mockResolvedValue([{ id: 'x' }]);
    await svc.tick();
    expect(trigger.trigger).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- schedule-runtime`
Expected: FAIL.

- [ ] **Step 4: Add `listDueSchedules` + `markScheduleRan` to ScheduleService**

Edit `apps/api/src/autonomy/schedule.service.ts`. Import cron-parser:

```ts
import { CronExpressionParser } from 'cron-parser';
```

Add `computeNextRunAt` helper and use it in `create()` to set `nextRunAt`:

```ts
  private computeNextRunAt(cronExpression: string, from: Date = new Date()): Date {
    const it = CronExpressionParser.parse(cronExpression, { currentDate: from });
    return it.next().toDate();
  }
```

Use it in `create()` right before `this.db.insert(...)`:

```ts
    const nextRunAt = this.computeNextRunAt(cronExpression);
    const [created] = await this.db
      .insert(agentSchedules)
      .values({
        userId,
        name,
        cronExpression,
        taskType,
        taskPayload: payload,
        enabled,
        nextRunAt,
      })
      .returning();
```

Similarly in `update()`, if `cronExpression` changed recompute `nextRunAt`.

Now add the two methods the runtime needs:

```ts
  async listDueSchedules(now: Date = new Date()) {
    return this.db
      .select()
      .from(agentSchedules)
      .where(
        and(
          eq(agentSchedules.enabled, true),
          sql`${agentSchedules.nextRunAt} <= ${now}`,
        ),
      );
  }

  async markScheduleRan(
    scheduleId: string,
    lastRunAt: Date,
    nextRunAt: Date,
  ): Promise<void> {
    await this.db
      .update(agentSchedules)
      .set({ lastRunAt, nextRunAt, updatedAt: new Date() })
      .where(eq(agentSchedules.id, scheduleId));
  }
```

- [ ] **Step 5: Implement ScheduleRuntimeService**

Create `apps/api/src/autonomy/schedule-runtime.service.ts`:

```ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronExpressionParser } from 'cron-parser';
import {
  AgentEventAggregateType,
  AgentEventType,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';
import { ScheduleService } from './schedule.service';
import { AnalysisRuntimeTriggerService } from './analysis-runtime-trigger.service';

interface ScheduleRow {
  id: string;
  userId: string;
  cronExpression: string;
  taskType: string;
  taskPayload: Record<string, unknown>;
}

@Injectable()
export class ScheduleRuntimeService {
  private readonly logger = new Logger(ScheduleRuntimeService.name);

  constructor(
    private readonly schedules: ScheduleService,
    private readonly trigger: AnalysisRuntimeTriggerService,
    private readonly events: AgentEventService,
    @Inject('ANALYSIS_RUNTIME_FLAG') private readonly flag: { enabled: boolean },
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.flag.enabled) return;
    const now = new Date();
    const due = (await this.schedules.listDueSchedules(now)) as ScheduleRow[];
    for (const row of due) {
      try {
        const prompt = this.buildPrompt(row);
        const { runId } = await this.trigger.trigger({
          userId: row.userId,
          sourceMode: 'SCHEDULE',
          prompt,
          payload: { scheduleId: row.id, taskType: row.taskType },
        });
        await this.events.append(
          row.userId,
          AgentEventAggregateType.SCHEDULE,
          row.id,
          AgentEventType.SCHEDULE_EXECUTED,
          { runId, taskType: row.taskType },
          null,
        );
        const nextRunAt = CronExpressionParser.parse(row.cronExpression, {
          currentDate: now,
        })
          .next()
          .toDate();
        await this.schedules.markScheduleRan(row.id, now, nextRunAt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Schedule ${row.id} tick failed: ${message}`);
        await this.events.append(
          row.userId,
          AgentEventAggregateType.SCHEDULE,
          row.id,
          AgentEventType.SCHEDULE_FAILED,
          { error: message },
          null,
        );
      }
    }
  }

  private buildPrompt(row: ScheduleRow): string {
    switch (row.taskType) {
      case 'PORTFOLIO_REVIEW':
        return 'Scheduled portfolio review: produce full analysis + decision + order drafts.';
      case 'MARKET_PULSE':
        return 'Scheduled market pulse: summarize macro liquidity + sentiment.';
      case 'BRAIN_REVIEW':
        return 'Scheduled strategy review: evaluate current investment theses against latest evidence.';
      case 'HEARTBEAT_WAKEUP':
        return 'Scheduled heartbeat wake-up: run drawdown + risk-limit check.';
      default:
        return `Scheduled task: ${row.taskType}`;
    }
  }
}

export const analysisRuntimeFlagProvider = {
  provide: 'ANALYSIS_RUNTIME_FLAG',
  useFactory: (config: import('@nestjs/config').ConfigService) => ({
    enabled: config.get<boolean>('ANALYSIS_RUNS_ENABLED', false),
  }),
  inject: [
    // Forward-referenced — this matches the runtime injection pattern so the
    // tests can construct the service with a plain { enabled } object.
    { token: 'ConfigService' } as never,
  ],
};
```

> Simpler alternative for the flag provider — define it inside `autonomy.module.ts` rather than as an exported object. Either works.

- [ ] **Step 6: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- schedule-runtime`
Expected: PASS.

```bash
git add apps/api/src/autonomy/schedule-runtime.service.ts \
        apps/api/src/autonomy/schedule.service.ts \
        apps/api/src/autonomy/__tests__/schedule-runtime.service.spec.ts
git commit -m "feat(autonomy): ScheduleRuntimeService ticks @Cron every minute and enqueues runs"
```

---

## Task 5: HeartbeatRuntimeService

Checks every user with an enabled heartbeat config whose `lastBeatAt` is older than `intervalSeconds`. For each, triggers a HEARTBEAT run.

**Files:**
- Create: `apps/api/src/autonomy/heartbeat-runtime.service.ts`
- Create: `apps/api/src/autonomy/__tests__/heartbeat-runtime.service.spec.ts`
- Modify: `apps/api/src/autonomy/heartbeat.service.ts` — add `listDueHeartbeats` + `markBeat`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/autonomy/__tests__/heartbeat-runtime.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatRuntimeService } from '../heartbeat-runtime.service';

describe('HeartbeatRuntimeService.tick', () => {
  let hb: { listDueHeartbeats: ReturnType<typeof vi.fn>; markBeat: ReturnType<typeof vi.fn> };
  let trigger: { trigger: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: HeartbeatRuntimeService;

  beforeEach(() => {
    hb = {
      listDueHeartbeats: vi.fn(),
      markBeat: vi.fn().mockResolvedValue(undefined),
    };
    trigger = { trigger: vi.fn().mockResolvedValue({ runId: 'run-hb' }) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new HeartbeatRuntimeService(hb as never, trigger as never, events as never, {
      enabled: true,
    });
  });

  it('triggers a HEARTBEAT run for each due user and updates lastBeatAt', async () => {
    hb.listDueHeartbeats.mockResolvedValue([
      { userId: 'u1', intervalSeconds: 600, drawdownAlertPct: '10.00' },
    ]);
    await svc.tick();
    expect(trigger.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sourceMode: 'HEARTBEAT' }),
    );
    expect(hb.markBeat).toHaveBeenCalledWith('u1', expect.any(Date));
    expect(events.append).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Extend HeartbeatService**

Edit `apps/api/src/autonomy/heartbeat.service.ts`:

```ts
  async listDueHeartbeats(now: Date = new Date()) {
    return this.db
      .select()
      .from(agentHeartbeatConfigs)
      .where(
        sql`${agentHeartbeatConfigs.enabled} = true AND (
          ${agentHeartbeatConfigs.lastBeatAt} IS NULL OR
          ${agentHeartbeatConfigs.lastBeatAt} + (${agentHeartbeatConfigs.intervalSeconds} * interval '1 second') <= ${now}
        )`,
      );
  }

  async markBeat(userId: string, beatAt: Date): Promise<void> {
    await this.db
      .update(agentHeartbeatConfigs)
      .set({ lastBeatAt: beatAt, updatedAt: new Date() })
      .where(eq(agentHeartbeatConfigs.userId, userId));
  }
```

Add the `sql` import if missing:

```ts
import { sql } from 'drizzle-orm';
```

- [ ] **Step 3: Implement HeartbeatRuntimeService**

Create `apps/api/src/autonomy/heartbeat-runtime.service.ts`:

```ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AgentEventAggregateType,
  AgentEventType,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';
import { HeartbeatService } from './heartbeat.service';
import { AnalysisRuntimeTriggerService } from './analysis-runtime-trigger.service';

interface HeartbeatRow {
  userId: string;
  intervalSeconds: number;
  drawdownAlertPct: string;
}

@Injectable()
export class HeartbeatRuntimeService {
  private readonly logger = new Logger(HeartbeatRuntimeService.name);

  constructor(
    private readonly heartbeats: HeartbeatService,
    private readonly trigger: AnalysisRuntimeTriggerService,
    private readonly events: AgentEventService,
    @Inject('ANALYSIS_RUNTIME_FLAG') private readonly flag: { enabled: boolean },
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.flag.enabled) return;
    const now = new Date();
    const due = (await this.heartbeats.listDueHeartbeats(now)) as HeartbeatRow[];
    for (const row of due) {
      try {
        await this.events.append(
          row.userId,
          AgentEventAggregateType.HEARTBEAT,
          null,
          AgentEventType.HEARTBEAT_TICK,
          { intervalSeconds: row.intervalSeconds, drawdownAlertPct: row.drawdownAlertPct },
          null,
        );
        await this.trigger.trigger({
          userId: row.userId,
          sourceMode: 'HEARTBEAT',
          prompt: `Heartbeat check: evaluate drawdown, position risk, and liquidity. Drawdown alert at ${row.drawdownAlertPct}%.`,
        });
        await this.heartbeats.markBeat(row.userId, now);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Heartbeat tick for ${row.userId} failed: ${message}`);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- heartbeat-runtime`
Expected: PASS.

```bash
git add apps/api/src/autonomy/heartbeat-runtime.service.ts \
        apps/api/src/autonomy/heartbeat.service.ts \
        apps/api/src/autonomy/__tests__/heartbeat-runtime.service.spec.ts
git commit -m "feat(autonomy): HeartbeatRuntimeService ticks and enqueues HEARTBEAT runs"
```

---

## Task 6: Wire Everything into AutonomyModule

**Files:**
- Modify: `apps/api/src/autonomy/autonomy.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Ensure `@nestjs/schedule` is installed**

Run: `pnpm list --filter @finsentinel/api @nestjs/schedule`.
If missing, run: `pnpm --filter @finsentinel/api add @nestjs/schedule`.

- [ ] **Step 2: Add ScheduleModule.forRoot() to app**

Edit `apps/api/src/app.module.ts`. Import `ScheduleModule`:

```ts
import { ScheduleModule } from '@nestjs/schedule';
```

Add to the `imports` array at the top of the list:

```ts
    ScheduleModule.forRoot(),
```

(Do this once. If it's already there, skip.)

- [ ] **Step 3: Rewrite autonomy.module.ts**

Replace `apps/api/src/autonomy/autonomy.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { QueueModule } from '../queue/queue.module';
import { ScheduleController } from './schedule.controller';
import { HeartbeatController } from './heartbeat.controller';
import { ScheduleService } from './schedule.service';
import { HeartbeatService } from './heartbeat.service';
import { AnalysisRuntimeTriggerService } from './analysis-runtime-trigger.service';
import { ScheduleRuntimeService } from './schedule-runtime.service';
import { HeartbeatRuntimeService } from './heartbeat-runtime.service';

@Module({
  imports: [AuthModule, EventsModule, AnalysisModule, QueueModule],
  controllers: [ScheduleController, HeartbeatController],
  providers: [
    ScheduleService,
    HeartbeatService,
    AnalysisRuntimeTriggerService,
    ScheduleRuntimeService,
    HeartbeatRuntimeService,
    {
      provide: 'ANALYSIS_RUNTIME_FLAG',
      useFactory: (config: ConfigService) => ({
        enabled: config.get<boolean>('ANALYSIS_RUNS_ENABLED', false),
      }),
      inject: [ConfigService],
    },
  ],
  exports: [ScheduleService, HeartbeatService, AnalysisRuntimeTriggerService],
})
export class AutonomyModule {}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @finsentinel/api typecheck
git add apps/api/src/autonomy/autonomy.module.ts apps/api/src/app.module.ts
git commit -m "feat(autonomy): wire runtime + triggers + @nestjs/schedule"
```

---

## Task 7: Optional Auto-Dispatch After Approval (Feature Flag)

By default, approving an execution only emits the artifact + marks the run complete. In some environments (paper trading in integration tests, or opt-in prod flows) you want the broker dispatch to happen immediately. Gate this behind `APPROVAL_AUTO_DISPATCH_ENABLED`.

**Files:**
- Modify: `apps/api/src/config/env.validation.ts`
- Modify: `apps/api/src/analysis/analysis-approval.service.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`

- [ ] **Step 1: Add the env flag**

Edit `apps/api/src/config/env.validation.ts`:

```ts
  APPROVAL_AUTO_DISPATCH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default('false'),
```

- [ ] **Step 2: Add the dispatch branch test**

Append to `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`:

```ts
describe('AnalysisApprovalService.resolve(APPROVE) with auto-dispatch', () => {
  it('when flag enabled, calls UnifiedTradingService.stageMany + commit + execute', async () => {
    // Build mocks identical to the preceding approve test, plus a trading stub:
    const trading = {
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue({ hash: 'h1', count: 1 }),
      execute: vi.fn().mockResolvedValue({ report: 'ok', results: [] }),
    };
    // Assume svc is built with flag={enabled:true} and `trading` injected.
    // ... (exercise svc.resolve and assert all 3 trading methods called)
  });
});
```

(Full test is left to the implementer to fill in using the same fake-db pattern already established.)

- [ ] **Step 3: Extend AnalysisApprovalService**

Inject `UnifiedTradingService` + `OrderDraftMapper` + a flag token. After `markCompleted` in the `APPROVE` branch:

```ts
      if (this.autoDispatchFlag.enabled) {
        for (const req of mappedRequests) {
          await this.trading.stage(args.userId, req);
        }
        const commit = await this.trading.commit(args.userId, `auto:run ${existing.runId}`);
        await this.trading.execute(args.userId);
      }
```

Flag provider in `analysis.module.ts`:

```ts
    {
      provide: 'APPROVAL_AUTO_DISPATCH_FLAG',
      useFactory: (config: ConfigService) => ({
        enabled: config.get<boolean>('APPROVAL_AUTO_DISPATCH_ENABLED', false),
      }),
      inject: [ConfigService],
    },
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config/env.validation.ts \
        apps/api/src/analysis/analysis-approval.service.ts \
        apps/api/src/analysis/analysis.module.ts \
        apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts
git commit -m "feat(analysis): optional auto-dispatch broker execution after approval"
```

---

## Task 8: Plan C Test Sweep + Boot Check

**Files:** none.

- [ ] **Step 1: Targeted test sweep**

Run:

```bash
pnpm --filter @finsentinel/api test -- \
  chat-upgrade-planner chat.service chat.controller \
  analysis-runtime-trigger schedule-runtime heartbeat-runtime \
  analysis-approval
```
Expected: green.

- [ ] **Step 2: API typecheck**

Run: `pnpm --filter @finsentinel/api typecheck`.

- [ ] **Step 3: Boot sanity**

Start the API with feature flags on in a test env:

```bash
ANALYSIS_RUNS_ENABLED=true CHAT_AUTO_UPGRADE_ENABLED=true pnpm --filter @finsentinel/api dev
```

Confirm logs show:
- `AnalysisRunConsumer worker started`
- `ScheduleRuntimeService ... tick` logging once per minute
- `HeartbeatRuntimeService ... tick` logging once per minute

Kill with Ctrl-C.

---

## Plan C Exit Criteria

- [ ] `POST /chat/stream` returns `X-Analysis-Run-Id` + `X-Analysis-Upgrade-Reason` when upgrade fires; body contains a short "Open Run" message.
- [ ] Chat request `"Give me a complete analysis of AAPL"` upgrades to a tracked run (planner intent rule).
- [ ] `ScheduleRuntimeService` ticks every minute, triggers runs for `enabled=true AND nextRunAt<=now()`, advances `nextRunAt` via `cron-parser`.
- [ ] `HeartbeatRuntimeService` ticks every minute, triggers runs for users whose `lastBeatAt` is beyond `intervalSeconds`, and updates `lastBeatAt`.
- [ ] Approving an approval marks the run complete; if `APPROVAL_AUTO_DISPATCH_ENABLED=true`, the unified trading stage/commit/execute fires.
- [ ] `ANALYSIS_RUNS_ENABLED=false` makes both runtime services no-ops.
- [ ] Targeted tests + API typecheck pass.

When green, proceed to **Plan D — Workspace UX + Hardening**.
