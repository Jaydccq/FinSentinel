# Plan A — Context Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `analysis_run` persistence model, BullMQ-backed runtime foundation, and unified Context Fabric so future team orchestration (Plan B) and entry-point integration (Plan C) can plug into one coherent runtime.

**Architecture:** Four new Drizzle tables (`analysis_runs`, `analysis_stages`, `analysis_artifacts`, `analysis_approvals`) + one new BullMQ queue (`ANALYSIS_RUN_QUEUE`) + services for run CRUD, checkpoint commit, approval tracking, preflight complexity planning, and context assembly. Event emission flows through the existing `AgentEventService` with new event/aggregate types. Dual-write model: materialized state tables are source of truth for queries; `agent_events` is the append-only audit log.

**Tech Stack:** Drizzle ORM, PostgreSQL, Zod, NestJS, BullMQ, ioredis, Vitest.

**Depends on:** nothing (foundational).
**Unblocks:** Plans B, C, D.

---

## File Structure

### New files

```
packages/shared/src/schemas/order-draft.ts        # Broker-neutral OrderDraft Zod schema
packages/shared/src/schemas/analysis.ts           # AnalysisRun / Stage / Artifact / Approval shared schemas
packages/shared/src/__tests__/order-draft-schema.test.ts
packages/shared/src/__tests__/analysis-schema.test.ts

packages/db/src/schema/analysis-runs.ts
packages/db/src/schema/analysis-stages.ts
packages/db/src/schema/analysis-artifacts.ts
packages/db/src/schema/analysis-approvals.ts
packages/db/migrations/V11__add_analysis_runtime_tables.sql

apps/api/src/queue/analysis-run.producer.ts
apps/api/src/queue/analysis-run.consumer.ts
apps/api/src/queue/__tests__/analysis-run.producer.spec.ts
apps/api/src/queue/__tests__/analysis-run.consumer.spec.ts

apps/api/src/analysis/analysis-run.service.ts
apps/api/src/analysis/analysis-checkpoint.service.ts
apps/api/src/analysis/analysis-approval.service.ts
apps/api/src/analysis/preflight-planner.service.ts
apps/api/src/analysis/context-complexity.service.ts
apps/api/src/analysis/context-fabric.service.ts
apps/api/src/analysis/run-orchestrator.service.ts
apps/api/src/analysis/analysis-run.controller.ts
apps/api/src/analysis/analysis-approval.controller.ts
apps/api/src/analysis/__tests__/analysis-run.service.spec.ts
apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts
apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts
apps/api/src/analysis/__tests__/preflight-planner.service.spec.ts
apps/api/src/analysis/__tests__/context-fabric.service.spec.ts
apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts
```

### Modified files

```
packages/shared/src/schemas/index.ts              # export analysis + order-draft
packages/shared/src/enums/agent-event-type.ts     # add analysis + approval event types
packages/shared/src/enums/agent-event-aggregate-type.ts  # add ANALYSIS_RUN, ANALYSIS_APPROVAL
packages/db/src/schema/index.ts                   # export 4 new tables
packages/db/src/schema/relations.ts               # wire relations

apps/api/src/queue/queue.constants.ts             # add ANALYSIS_RUN_QUEUE
apps/api/src/queue/queue.module.ts                # register analysis-run queue + producer + consumer
apps/api/src/analysis/analysis.module.ts          # register new controllers/services
apps/api/src/app.module.ts                        # ensure analysis module imports
apps/api/src/config/env.validation.ts             # add ANALYSIS_RUNS_ENABLED flag
```

Each file has one responsibility. Tables live beside existing Drizzle style. BullMQ wiring mirrors the existing `vectorize` pattern. The service layer is split so run CRUD, checkpoint commit, approval lifecycle, and context assembly can be tested independently.

---

## Conventions Enforced

- **TDD**: every service + schema lands via failing test → impl → passing test → commit.
- **Zod-first**: all shared contracts are Zod schemas; table columns derive their JSON column shapes from the Zod types via `z.infer<typeof ...>`.
- **Dual-write invariant**: every state mutation on a run also appends an `agentEvent`. Tests must assert both.
- **No stubs merged**: every exported method has either a passing test or is removed.
- **No unscoped access**: all queries filter by `userId`; every controller uses `@JwtGuard` + `@CurrentUser()` like existing modules.

---

## Task 1: Shared `OrderDraft` Schema

The `orderDrafts` JSON object is the single broker-neutral contract emitted by the Execution Prep Team (Plan B). Locking it here first prevents schema drift.

**Files:**
- Create: `packages/shared/src/schemas/order-draft.ts`
- Create: `packages/shared/src/__tests__/order-draft-schema.test.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Write the failing schema test**

Create `packages/shared/src/__tests__/order-draft-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orderDraftSchema, orderDraftsPayloadSchema } from '../schemas/order-draft';

describe('orderDraftSchema', () => {
  const validDraft = {
    draftId: '7b6f9f40-9d2e-49a7-a2ae-42a0c0c1f5c3',
    portfolioIntent: 'OPEN',
    assetType: 'EQUITY',
    symbol: 'AAPL',
    side: 'BUY',
    quantity: { mode: 'SHARES', value: 100 },
    orderType: 'MARKET',
    limitPrice: null,
    stopPrice: null,
    timeInForce: 'DAY',
    thesisRef: 'artifact-1',
    riskRef: 'artifact-2',
    maxSlippageBps: 50,
    maxPositionPercent: 5,
    brokerConstraints: { allowFractional: false, extendedHours: false },
    approvalRequired: true,
    warnings: [],
  };

  it('accepts a fully populated v1 draft', () => {
    expect(orderDraftSchema.parse(validDraft)).toEqual(validDraft);
  });

  it('rejects broker-specific fields that leak into the draft', () => {
    const leaked = { ...validDraft, alpacaAccountId: 'abc' };
    expect(() => orderDraftSchema.strict().parse(leaked)).toThrow();
  });

  it('rejects an invalid portfolioIntent', () => {
    const bad = { ...validDraft, portfolioIntent: 'LONG' };
    expect(() => orderDraftSchema.parse(bad)).toThrow();
  });

  it('requires approvalRequired === true (v1 invariant)', () => {
    const bad = { ...validDraft, approvalRequired: false };
    expect(() => orderDraftSchema.parse(bad)).toThrow();
  });

  it('payload wrapper accepts an array of drafts', () => {
    expect(
      orderDraftsPayloadSchema.parse({ orderDrafts: [validDraft] }),
    ).toEqual({ orderDrafts: [validDraft] });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @finsentinel/shared test -- order-draft-schema`
Expected: FAIL — `Cannot find module '../schemas/order-draft'`.

- [ ] **Step 3: Implement the schema**

Create `packages/shared/src/schemas/order-draft.ts`:

```ts
import { z } from 'zod';

export const portfolioIntentSchema = z.enum([
  'OPEN',
  'ADD',
  'REDUCE',
  'CLOSE',
  'HEDGE',
  'REBALANCE',
]);
export type PortfolioIntent = z.infer<typeof portfolioIntentSchema>;

export const orderDraftAssetTypeSchema = z.enum([
  'EQUITY',
  'ETF',
  'CRYPTO',
  'OPTION',
  'FUTURE',
]);
export type OrderDraftAssetType = z.infer<typeof orderDraftAssetTypeSchema>;

export const orderDraftSideSchema = z.enum(['BUY', 'SELL']);
export type OrderDraftSide = z.infer<typeof orderDraftSideSchema>;

export const orderDraftQuantitySchema = z.object({
  mode: z.enum(['SHARES', 'NOTIONAL_USD', 'PERCENT_NAV', 'CONTRACTS']),
  value: z.number().positive(),
});
export type OrderDraftQuantity = z.infer<typeof orderDraftQuantitySchema>;

export const orderDraftOrderTypeSchema = z.enum([
  'MARKET',
  'LIMIT',
  'STOP',
  'STOP_LIMIT',
]);

export const orderDraftTimeInForceSchema = z.enum(['DAY', 'GTC', 'IOC', 'FOK']);

export const orderDraftBrokerConstraintsSchema = z.object({
  allowFractional: z.boolean(),
  extendedHours: z.boolean(),
});

export const orderDraftSchema = z.object({
  draftId: z.string().uuid(),
  portfolioIntent: portfolioIntentSchema,
  assetType: orderDraftAssetTypeSchema,
  symbol: z.string().min(1).max(40),
  side: orderDraftSideSchema,
  quantity: orderDraftQuantitySchema,
  orderType: orderDraftOrderTypeSchema,
  limitPrice: z.number().positive().nullable(),
  stopPrice: z.number().positive().nullable(),
  timeInForce: orderDraftTimeInForceSchema,
  thesisRef: z.string().min(1),
  riskRef: z.string().min(1),
  maxSlippageBps: z.number().int().min(0).max(10_000),
  maxPositionPercent: z.number().min(0).max(100),
  brokerConstraints: orderDraftBrokerConstraintsSchema,
  approvalRequired: z.literal(true),
  warnings: z.array(z.string()),
});
export type OrderDraft = z.infer<typeof orderDraftSchema>;

export const orderDraftsPayloadSchema = z.object({
  orderDrafts: z.array(orderDraftSchema),
});
export type OrderDraftsPayload = z.infer<typeof orderDraftsPayloadSchema>;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @finsentinel/shared test -- order-draft-schema`
Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Re-export from shared index**

Edit `packages/shared/src/schemas/index.ts` — append:

```ts
export * from './order-draft';
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @finsentinel/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/schemas/order-draft.ts \
        packages/shared/src/schemas/index.ts \
        packages/shared/src/__tests__/order-draft-schema.test.ts
git commit -m "feat(shared): add broker-neutral OrderDraft schema"
```

---

## Task 2: Shared Analysis Schemas

These Zod types define the JSON shapes stored in the new Drizzle JSONB columns, plus API request/response contracts used by Plan A controllers and Plan D web clients.

**Files:**
- Create: `packages/shared/src/schemas/analysis.ts`
- Create: `packages/shared/src/__tests__/analysis-schema.test.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Write the failing schema test**

Create `packages/shared/src/__tests__/analysis-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  analysisRunSourceModeSchema,
  analysisRunStatusSchema,
  analysisStageKeySchema,
  stageStatusSchema,
  stageStructuredOutputSchema,
  sharedContextSchema,
  decisionObjectSchema,
  complexityEstimateSchema,
  createRunRequestSchema,
} from '../schemas/analysis';

describe('analysis schemas', () => {
  it('lists exactly the 4 source modes', () => {
    const values = analysisRunSourceModeSchema.options;
    expect(values.sort()).toEqual(['CHAT', 'HEARTBEAT', 'SCHEDULE', 'WORKSPACE'].sort());
  });

  it('lists exactly the 7 run statuses', () => {
    expect(analysisRunStatusSchema.options.sort()).toEqual(
      [
        'QUEUED',
        'RUNNING',
        'WAITING_APPROVAL',
        'PAUSED',
        'FAILED',
        'COMPLETED',
        'CANCELED',
      ].sort(),
    );
  });

  it('lists the v1 stage keys aligned to team topology', () => {
    expect(analysisStageKeySchema.options.sort()).toEqual(
      [
        'INTELLIGENCE',
        'THESIS',
        'RISK',
        'EXECUTION_PREP',
        'HUMAN_APPROVAL',
      ].sort(),
    );
  });

  it('stageStatus enumerates lifecycle values', () => {
    expect(stageStatusSchema.options.sort()).toEqual(
      ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED'].sort(),
    );
  });

  it('stageStructuredOutput requires the common handoff skeleton', () => {
    const valid = {
      summary: 's',
      thesis: 't',
      risks: [],
      openQuestions: [],
      citations: [],
      confidence: 0.7,
    };
    expect(stageStructuredOutputSchema.parse(valid)).toMatchObject(valid);
  });

  it('sharedContext splits context into 4 layers', () => {
    const ctx = {
      longTermPreferenceContext: { summary: 'a', sourceIds: [] },
      midTermStrategyContext: { summary: 'b', sourceIds: [] },
      shortTermSessionContext: { summary: 'c', sourceIds: [] },
      retrievalContext: { summary: 'd', sourceIds: [] },
    };
    expect(sharedContextSchema.parse(ctx)).toEqual(ctx);
  });

  it('decisionObject carries the three downstream payload buckets', () => {
    const d = {
      portfolioDecision: 'HOLD',
      allocationGuidance: { notes: '', targets: [] },
      riskLimits: { maxDrawdownPct: 10, stopLossTriggers: [] },
      alertTriggers: [],
      confidence: 0.8,
      evidenceRefs: [],
      executionPayload: { orderDrafts: [] },
      alertPayload: { alerts: [] },
      strategyArchivePayload: { snapshot: {} },
    };
    expect(decisionObjectSchema.parse(d)).toMatchObject(d);
  });

  it('complexityEstimate carries the v1 thresholds + decision flag', () => {
    const est = {
      predictedToolCalls: 8,
      predictedToolRounds: 4,
      predictedWallClockSec: 30,
      upgradeRecommended: true,
      upgradeReason: 'predictedToolCalls>=6',
    };
    expect(complexityEstimateSchema.parse(est)).toEqual(est);
  });

  it('createRunRequest requires a prompt and sourceMode', () => {
    const req = {
      prompt: 'Analyze AAPL and decide allocation',
      sourceMode: 'WORKSPACE',
      ticker: 'AAPL',
    };
    expect(createRunRequestSchema.parse(req)).toMatchObject(req);
    expect(() => createRunRequestSchema.parse({ prompt: '' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @finsentinel/shared test -- analysis-schema`
Expected: FAIL — `Cannot find module '../schemas/analysis'`.

- [ ] **Step 3: Implement the schemas**

Create `packages/shared/src/schemas/analysis.ts`:

```ts
import { z } from 'zod';
import { orderDraftsPayloadSchema } from './order-draft';

// ── Enums ────────────────────────────────────────────────────────────────────
export const analysisRunSourceModeSchema = z.enum([
  'CHAT',
  'WORKSPACE',
  'SCHEDULE',
  'HEARTBEAT',
]);
export type AnalysisRunSourceMode = z.infer<typeof analysisRunSourceModeSchema>;

export const analysisRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'PAUSED',
  'FAILED',
  'COMPLETED',
  'CANCELED',
]);
export type AnalysisRunStatus = z.infer<typeof analysisRunStatusSchema>;

export const analysisStageKeySchema = z.enum([
  'INTELLIGENCE',
  'THESIS',
  'RISK',
  'EXECUTION_PREP',
  'HUMAN_APPROVAL',
]);
export type AnalysisStageKey = z.infer<typeof analysisStageKeySchema>;

export const stageStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const artifactKindSchema = z.enum([
  'STAGE_STRUCTURED_OUTPUT',
  'STAGE_HUMAN_REPORT',
  'ORDER_DRAFTS',
  'EXECUTION_PAYLOAD',
  'ALERT_PAYLOAD',
  'STRATEGY_ARCHIVE',
  'FINAL_REPORT',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const approvalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

// ── Context layers ───────────────────────────────────────────────────────────
export const contextLayerSchema = z.object({
  summary: z.string(),
  sourceIds: z.array(z.string()),
  updatedAt: z.string().datetime().optional(),
});
export type ContextLayer = z.infer<typeof contextLayerSchema>;

export const sharedContextSchema = z.object({
  longTermPreferenceContext: contextLayerSchema,
  midTermStrategyContext: contextLayerSchema,
  shortTermSessionContext: contextLayerSchema,
  retrievalContext: contextLayerSchema,
});
export type SharedContext = z.infer<typeof sharedContextSchema>;

// ── Stage I/O handoff ────────────────────────────────────────────────────────
export const citationSchema = z.object({
  artifactId: z.string().optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
});
export type Citation = z.infer<typeof citationSchema>;

export const stageStructuredOutputSchema = z
  .object({
    summary: z.string(),
    thesis: z.string(),
    risks: z.array(z.string()),
    openQuestions: z.array(z.string()),
    citations: z.array(citationSchema),
    confidence: z.number().min(0).max(1),
  })
  .passthrough(); // roles may extend
export type StageStructuredOutput = z.infer<typeof stageStructuredOutputSchema>;

// ── Decision object (system-primary) ─────────────────────────────────────────
export const decisionObjectSchema = z.object({
  portfolioDecision: z.string(), // e.g. 'BUY' | 'HOLD' | 'SELL' | 'HEDGE'
  allocationGuidance: z.object({
    notes: z.string(),
    targets: z.array(
      z.object({
        symbol: z.string(),
        targetPercent: z.number(),
      }),
    ),
  }),
  riskLimits: z.object({
    maxDrawdownPct: z.number(),
    stopLossTriggers: z.array(z.string()),
  }),
  alertTriggers: z.array(
    z.object({
      condition: z.string(),
      channel: z.string().optional(),
    }),
  ),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()),
  executionPayload: orderDraftsPayloadSchema,
  alertPayload: z.object({ alerts: z.array(z.record(z.string(), z.unknown())) }),
  strategyArchivePayload: z.object({ snapshot: z.record(z.string(), z.unknown()) }),
});
export type DecisionObject = z.infer<typeof decisionObjectSchema>;

// ── Preflight complexity estimate ────────────────────────────────────────────
export const complexityEstimateSchema = z.object({
  predictedToolCalls: z.number().int().nonnegative(),
  predictedToolRounds: z.number().int().nonnegative(),
  predictedWallClockSec: z.number().nonnegative(),
  upgradeRecommended: z.boolean(),
  upgradeReason: z.string(),
});
export type ComplexityEstimate = z.infer<typeof complexityEstimateSchema>;

// ── API request / response contracts ─────────────────────────────────────────
export const createRunRequestSchema = z.object({
  prompt: z.string().min(1),
  sourceMode: analysisRunSourceModeSchema,
  ticker: z.string().optional(),
  portfolioId: z.string().uuid().optional(),
  parentChatSessionId: z.string().uuid().optional(),
  enabledTeams: z.array(analysisStageKeySchema).optional(),
  researchDepth: z.enum(['SHALLOW', 'STANDARD', 'DEEP']).optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const analysisRunResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sourceMode: analysisRunSourceModeSchema,
  status: analysisRunStatusSchema,
  currentStageKey: analysisStageKeySchema.nullable(),
  complexityScore: z.number().nullable(),
  upgradeReason: z.string().nullable(),
  parentChatSessionId: z.string().uuid().nullable(),
  inputSnapshot: z.record(z.string(), z.unknown()),
  sharedContext: sharedContextSchema.nullable(),
  decisionObject: decisionObjectSchema.nullable(),
  finalReportMarkdown: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});
export type AnalysisRunResponse = z.infer<typeof analysisRunResponseSchema>;

export const analysisStageResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stageKey: analysisStageKeySchema,
  status: stageStatusSchema,
  checkpointVersion: z.number().int().nonnegative(),
  parallelGroupKey: z.string().nullable(),
  structuredOutput: stageStructuredOutputSchema.nullable(),
  humanReportMarkdown: z.string().nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type AnalysisStageResponse = z.infer<typeof analysisStageResponseSchema>;

export const analysisArtifactResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
  artifactKind: artifactKindSchema,
  artifactName: z.string(),
  mimeType: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  storageUri: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AnalysisArtifactResponse = z.infer<typeof analysisArtifactResponseSchema>;

export const analysisApprovalResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  approvalType: z.literal('EXECUTION_APPROVAL'),
  status: approvalStatusSchema,
  requestedPayload: z.record(z.string(), z.unknown()),
  approvedPayload: z.record(z.string(), z.unknown()).nullable(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().uuid().nullable(),
});
export type AnalysisApprovalResponse = z.infer<typeof analysisApprovalResponseSchema>;

export const approveExecutionRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().optional(),
});
export type ApproveExecutionRequest = z.infer<typeof approveExecutionRequestSchema>;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @finsentinel/shared test -- analysis-schema`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Re-export from shared index**

Edit `packages/shared/src/schemas/index.ts` — append:

```ts
export * from './analysis';
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @finsentinel/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/schemas/analysis.ts \
        packages/shared/src/schemas/index.ts \
        packages/shared/src/__tests__/analysis-schema.test.ts
git commit -m "feat(shared): add analysis run/stage/artifact/approval schemas"
```

---

## Task 3: Extend Event Enums

**Files:**
- Modify: `packages/shared/src/enums/agent-event-type.ts`
- Modify: `packages/shared/src/enums/agent-event-aggregate-type.ts`

- [ ] **Step 1: Add aggregate types**

Edit `packages/shared/src/enums/agent-event-aggregate-type.ts` — add two entries to the object:

```ts
export const AgentEventAggregateType = {
  CHAT_SESSION: 'CHAT_SESSION',
  TRADE_WALLET: 'TRADE_WALLET',
  AGENT_BRAIN: 'AGENT_BRAIN',
  USER_PROFILE: 'USER_PROFILE',
  SCHEDULE: 'SCHEDULE',
  HEARTBEAT: 'HEARTBEAT',
  SYSTEM: 'SYSTEM',
  ANALYSIS_RUN: 'ANALYSIS_RUN',
  ANALYSIS_APPROVAL: 'ANALYSIS_APPROVAL',
} as const;
```

- [ ] **Step 2: Add event types**

Edit `packages/shared/src/enums/agent-event-type.ts` — append the new keys before the closing brace:

```ts
  // Analysis runtime lifecycle
  RUN_QUEUED: 'RUN_QUEUED',
  RUN_STARTED: 'RUN_STARTED',
  RUN_PAUSED: 'RUN_PAUSED',
  RUN_RESUMED: 'RUN_RESUMED',
  RUN_FAILED: 'RUN_FAILED',
  RUN_COMPLETED: 'RUN_COMPLETED',
  RUN_CANCELED: 'RUN_CANCELED',
  // Stage-level (team-level) events
  INTELLIGENCE_TEAM_STARTED: 'INTELLIGENCE_TEAM_STARTED',
  INTELLIGENCE_TEAM_COMPLETED: 'INTELLIGENCE_TEAM_COMPLETED',
  THESIS_TEAM_STARTED: 'THESIS_TEAM_STARTED',
  THESIS_TEAM_COMPLETED: 'THESIS_TEAM_COMPLETED',
  RISK_TEAM_STARTED: 'RISK_TEAM_STARTED',
  RISK_TEAM_COMPLETED: 'RISK_TEAM_COMPLETED',
  EXECUTION_PREP_TEAM_STARTED: 'EXECUTION_PREP_TEAM_STARTED',
  EXECUTION_PREP_TEAM_COMPLETED: 'EXECUTION_PREP_TEAM_COMPLETED',
  // Role-level events inside Thesis team
  POSITIVE_CASE_STARTED: 'POSITIVE_CASE_STARTED',
  POSITIVE_CASE_COMPLETED: 'POSITIVE_CASE_COMPLETED',
  NEGATIVE_CASE_STARTED: 'NEGATIVE_CASE_STARTED',
  NEGATIVE_CASE_COMPLETED: 'NEGATIVE_CASE_COMPLETED',
  THESIS_LEAD_STARTED: 'THESIS_LEAD_STARTED',
  THESIS_LEAD_COMPLETED: 'THESIS_LEAD_COMPLETED',
  // Approval gate
  EXECUTION_APPROVAL_REQUIRED: 'EXECUTION_APPROVAL_REQUIRED',
  EXECUTION_APPROVED: 'EXECUTION_APPROVED',
  EXECUTION_REJECTED: 'EXECUTION_REJECTED',
  // Misc
  TOOL_CALLED: 'TOOL_CALLED',
  STAGE_CHECKPOINT_COMMITTED: 'STAGE_CHECKPOINT_COMMITTED',
  CHAT_AUTO_UPGRADED: 'CHAT_AUTO_UPGRADED',
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @finsentinel/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/enums/agent-event-type.ts \
        packages/shared/src/enums/agent-event-aggregate-type.ts
git commit -m "feat(shared): add analysis runtime event + aggregate types"
```

---

## Task 4: Drizzle Table — `analysis_runs`

**Files:**
- Create: `packages/db/src/schema/analysis-runs.ts`

- [ ] **Step 1: Write the table definition**

Create `packages/db/src/schema/analysis-runs.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  numeric,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import type {
  AnalysisRunSourceMode,
  AnalysisRunStatus,
  AnalysisStageKey,
  SharedContext,
  DecisionObject,
} from '@finsentinel/shared';

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sourceMode: varchar('source_mode', { length: 20 })
      .$type<AnalysisRunSourceMode>()
      .notNull(),
    status: varchar('status', { length: 24 })
      .$type<AnalysisRunStatus>()
      .notNull()
      .default('QUEUED'),
    currentStageKey: varchar('current_stage_key', { length: 32 })
      .$type<AnalysisStageKey>(),
    complexityScore: numeric('complexity_score', { precision: 8, scale: 2 }),
    upgradeReason: varchar('upgrade_reason', { length: 255 }),
    parentChatSessionId: uuid('parent_chat_session_id'),
    inputSnapshotJson: jsonb('input_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sharedContextJson: jsonb('shared_context_json').$type<SharedContext | null>(),
    decisionObjectJson: jsonb('decision_object_json').$type<DecisionObject | null>(),
    finalReportMarkdown: text('final_report_markdown'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_analysis_runs_user_created').on(table.userId, table.createdAt.desc()),
    index('idx_analysis_runs_user_status').on(table.userId, table.status),
    index('idx_analysis_runs_parent_chat_session').on(table.parentChatSessionId),
  ],
);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @finsentinel/db typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/analysis-runs.ts
git commit -m "feat(db): add analysis_runs drizzle schema"
```

---

## Task 5: Drizzle Table — `analysis_stages`

**Files:**
- Create: `packages/db/src/schema/analysis-stages.ts`

- [ ] **Step 1: Write the table definition**

Create `packages/db/src/schema/analysis-stages.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import type {
  AnalysisStageKey,
  StageStatus,
  StageStructuredOutput,
} from '@finsentinel/shared';

export const analysisStages = pgTable(
  'analysis_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    stageKey: varchar('stage_key', { length: 32 })
      .$type<AnalysisStageKey>()
      .notNull(),
    status: varchar('status', { length: 16 })
      .$type<StageStatus>()
      .notNull()
      .default('PENDING'),
    checkpointVersion: integer('checkpoint_version').notNull().default(0),
    parallelGroupKey: varchar('parallel_group_key', { length: 40 }),
    structuredOutputJson: jsonb('structured_output_json')
      .$type<StageStructuredOutput | null>(),
    humanReportMarkdown: text('human_report_markdown'),
    errorJson: jsonb('error_json').$type<Record<string, unknown> | null>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uk_analysis_stages_run_stage_key').on(table.runId, table.stageKey),
    index('idx_analysis_stages_run_status').on(table.runId, table.status),
  ],
);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @finsentinel/db typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/analysis-stages.ts
git commit -m "feat(db): add analysis_stages drizzle schema"
```

---

## Task 6: Drizzle Table — `analysis_artifacts`

**Files:**
- Create: `packages/db/src/schema/analysis-artifacts.ts`

- [ ] **Step 1: Write the table definition**

Create `packages/db/src/schema/analysis-artifacts.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import { analysisStages } from './analysis-stages';
import type { ArtifactKind } from '@finsentinel/shared';

export const analysisArtifacts = pgTable(
  'analysis_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').references(() => analysisStages.id, {
      onDelete: 'set null',
    }),
    artifactKind: varchar('artifact_kind', { length: 32 })
      .$type<ArtifactKind>()
      .notNull(),
    artifactName: varchar('artifact_name', { length: 120 }).notNull(),
    mimeType: varchar('mime_type', { length: 80 }).notNull().default('application/json'),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown> | null>(),
    storageUri: varchar('storage_uri', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_analysis_artifacts_run_kind').on(table.runId, table.artifactKind),
    index('idx_analysis_artifacts_stage').on(table.stageId),
  ],
);
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @finsentinel/db typecheck`

```bash
git add packages/db/src/schema/analysis-artifacts.ts
git commit -m "feat(db): add analysis_artifacts drizzle schema"
```

---

## Task 7: Drizzle Table — `analysis_approvals`

**Files:**
- Create: `packages/db/src/schema/analysis-approvals.ts`

- [ ] **Step 1: Write the table definition**

Create `packages/db/src/schema/analysis-approvals.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import { users } from './users';
import type { ApprovalStatus } from '@finsentinel/shared';

export const analysisApprovals = pgTable(
  'analysis_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    approvalType: varchar('approval_type', { length: 40 })
      .notNull()
      .default('EXECUTION_APPROVAL'),
    status: varchar('status', { length: 16 })
      .$type<ApprovalStatus>()
      .notNull()
      .default('PENDING'),
    requestedPayloadJson: jsonb('requested_payload_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    approvedPayloadJson: jsonb('approved_payload_json')
      .$type<Record<string, unknown> | null>(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
  },
  (table) => [
    index('idx_analysis_approvals_run_status').on(table.runId, table.status),
  ],
);
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @finsentinel/db typecheck
git add packages/db/src/schema/analysis-approvals.ts
git commit -m "feat(db): add analysis_approvals drizzle schema"
```

---

## Task 8: Wire Schema Index + Relations

**Files:**
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/relations.ts`

- [ ] **Step 1: Export tables from the barrel**

Edit `packages/db/src/schema/index.ts`. Add after the existing `watchlistItems` export:

```ts
export { analysisRuns } from './analysis-runs';
export { analysisStages } from './analysis-stages';
export { analysisArtifacts } from './analysis-artifacts';
export { analysisApprovals } from './analysis-approvals';
```

And add to the relations re-export block:

```ts
export {
  // ... existing ...
  analysisRunsRelations,
  analysisStagesRelations,
  analysisArtifactsRelations,
  analysisApprovalsRelations,
} from './relations';
```

- [ ] **Step 2: Add relation definitions**

Append to `packages/db/src/schema/relations.ts`:

```ts
import { analysisRuns } from './analysis-runs';
import { analysisStages } from './analysis-stages';
import { analysisArtifacts } from './analysis-artifacts';
import { analysisApprovals } from './analysis-approvals';

export const analysisRunsRelations = relations(analysisRuns, ({ one, many }) => ({
  user: one(users, { fields: [analysisRuns.userId], references: [users.id] }),
  stages: many(analysisStages),
  artifacts: many(analysisArtifacts),
  approvals: many(analysisApprovals),
}));

export const analysisStagesRelations = relations(analysisStages, ({ one, many }) => ({
  run: one(analysisRuns, {
    fields: [analysisStages.runId],
    references: [analysisRuns.id],
  }),
  artifacts: many(analysisArtifacts),
}));

export const analysisArtifactsRelations = relations(analysisArtifacts, ({ one }) => ({
  run: one(analysisRuns, {
    fields: [analysisArtifacts.runId],
    references: [analysisRuns.id],
  }),
  stage: one(analysisStages, {
    fields: [analysisArtifacts.stageId],
    references: [analysisStages.id],
  }),
}));

export const analysisApprovalsRelations = relations(analysisApprovals, ({ one }) => ({
  run: one(analysisRuns, {
    fields: [analysisApprovals.runId],
    references: [analysisRuns.id],
  }),
  resolvedBy: one(users, {
    fields: [analysisApprovals.resolvedByUserId],
    references: [users.id],
  }),
}));
```

Also add `analysisRuns: many(analysisRuns)` to the `usersRelations` object (find `export const usersRelations = relations(users, ({ many, one })` and insert it).

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @finsentinel/db typecheck
git add packages/db/src/schema/index.ts packages/db/src/schema/relations.ts
git commit -m "feat(db): wire analysis runtime tables into schema index + relations"
```

---

## Task 9: SQL Migration V11

**Files:**
- Create: `packages/db/migrations/V11__add_analysis_runtime_tables.sql`

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/V11__add_analysis_runtime_tables.sql`:

```sql
-- ============================================================================
-- V11: Add analysis runtime tables (runs, stages, artifacts, approvals)
-- ============================================================================

CREATE TABLE IF NOT EXISTS analysis_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    source_mode             VARCHAR(20) NOT NULL,
    status                  VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    current_stage_key       VARCHAR(32),
    complexity_score        NUMERIC(8,2),
    upgrade_reason          VARCHAR(255),
    parent_chat_session_id  UUID,
    input_snapshot_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    shared_context_json     JSONB,
    decision_object_json    JSONB,
    final_report_markdown   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    archived_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_created
    ON analysis_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_status
    ON analysis_runs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_parent_chat_session
    ON analysis_runs(parent_chat_session_id);

CREATE TABLE IF NOT EXISTS analysis_stages (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    stage_key               VARCHAR(32) NOT NULL,
    status                  VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    checkpoint_version      INTEGER NOT NULL DEFAULT 0,
    parallel_group_key      VARCHAR(40),
    structured_output_json  JSONB,
    human_report_markdown   TEXT,
    error_json              JSONB,
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_analysis_stages_run_stage_key
    ON analysis_stages(run_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_analysis_stages_run_status
    ON analysis_stages(run_id, status);

CREATE TABLE IF NOT EXISTS analysis_artifacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    stage_id        UUID REFERENCES analysis_stages(id) ON DELETE SET NULL,
    artifact_kind   VARCHAR(32) NOT NULL,
    artifact_name   VARCHAR(120) NOT NULL,
    mime_type       VARCHAR(80) NOT NULL DEFAULT 'application/json',
    payload_json    JSONB,
    storage_uri     VARCHAR(512),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_run_kind
    ON analysis_artifacts(run_id, artifact_kind);
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_stage
    ON analysis_artifacts(stage_id);

CREATE TABLE IF NOT EXISTS analysis_approvals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    approval_type           VARCHAR(40) NOT NULL DEFAULT 'EXECUTION_APPROVAL',
    status                  VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    requested_payload_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved_payload_json   JSONB,
    requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at             TIMESTAMPTZ,
    resolved_by_user_id     UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_approvals_run_status
    ON analysis_approvals(run_id, status);
```

- [ ] **Step 2: Apply migration against local Postgres**

Confirm `docker-compose up -d postgres` is running, then apply the migration. Use whatever migration runner the repo uses (check `packages/db/package.json`):

Run: `pnpm --filter @finsentinel/db migrate`
Expected: `V11__add_analysis_runtime_tables.sql` applied with exit 0.

If the project uses raw SQL apply instead, run:
```bash
psql "$DATABASE_URL" -f packages/db/migrations/V11__add_analysis_runtime_tables.sql
```

- [ ] **Step 3: Verify tables exist**

Run:
```bash
psql "$DATABASE_URL" -c "\d analysis_runs" \
                     -c "\d analysis_stages" \
                     -c "\d analysis_artifacts" \
                     -c "\d analysis_approvals"
```
Expected: all 4 tables listed with the columns defined above.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/V11__add_analysis_runtime_tables.sql
git commit -m "feat(db): V11 analysis runtime migration"
```

---

## Task 10: BullMQ `ANALYSIS_RUN_QUEUE`

Add a new queue mirroring the existing vectorize wiring so the runtime can enqueue run-step jobs.

**Files:**
- Modify: `apps/api/src/queue/queue.constants.ts`
- Modify: `apps/api/src/queue/queue.module.ts`

- [ ] **Step 1: Add queue constants**

Edit `apps/api/src/queue/queue.constants.ts` — append:

```ts
export const ANALYSIS_RUN_QUEUE = 'finsentinel-analysis-run';
export const ANALYSIS_RUN_QUEUE_TOKEN = 'ANALYSIS_RUN_QUEUE';
```

- [ ] **Step 2: Register queue in module**

Edit `apps/api/src/queue/queue.module.ts`. In the imports at the top, add:

```ts
import {
  VECTORIZE_QUEUE,
  NEWS_ENRICH_QUEUE,
  GRAPH_ENRICH_QUEUE,
  ANALYSIS_RUN_QUEUE,
  VECTORIZE_QUEUE_TOKEN,
  NEWS_ENRICH_QUEUE_TOKEN,
  GRAPH_ENRICH_QUEUE_TOKEN,
  ANALYSIS_RUN_QUEUE_TOKEN,
} from './queue.constants';
import { AnalysisRunProducer } from './analysis-run.producer';
import { AnalysisRunConsumer } from './analysis-run.consumer';
```

In `providers` (after the `GRAPH_ENRICH_QUEUE_TOKEN` provider), add:

```ts
    {
      provide: ANALYSIS_RUN_QUEUE_TOKEN,
      useFactory: (connection: ConnectionOptions) =>
        new Queue(ANALYSIS_RUN_QUEUE, { connection }),
      inject: ['BULLMQ_CONNECTION'],
    },
```

Add `AnalysisRunProducer` and `AnalysisRunConsumer` to `providers`, and add `AnalysisRunProducer` to the `exports` array.

Also add `forwardRef(() => AnalysisModule)` to the `imports` array to avoid circular dep. (Do this in Task 17 once `AnalysisModule` is defined; for now just leave the producer/consumer registration.)

- [ ] **Step 3: Commit** (no tests yet — they land with Tasks 11 and 12)

```bash
git add apps/api/src/queue/queue.constants.ts apps/api/src/queue/queue.module.ts
git commit -m "feat(queue): register ANALYSIS_RUN_QUEUE"
```

---

## Task 11: AnalysisRunProducer

Enqueues a run-step job. Job payload shape: `{ runId, userId, stepKind }` where `stepKind` is one of `PREFLIGHT | EXECUTE_STAGE | RESUME`.

**Files:**
- Create: `apps/api/src/queue/analysis-run.producer.ts`
- Create: `apps/api/src/queue/__tests__/analysis-run.producer.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/queue/__tests__/analysis-run.producer.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { AnalysisRunProducer } from '../analysis-run.producer';
import { ANALYSIS_RUN_QUEUE_TOKEN } from '../queue.constants';
import { MetricsService } from '../../common/services/metrics.service';

describe('AnalysisRunProducer', () => {
  let producer: AnalysisRunProducer;
  let mockQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockQueue = { add: vi.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        AnalysisRunProducer,
        { provide: ANALYSIS_RUN_QUEUE_TOKEN, useValue: mockQueue },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            observeHistogram: vi.fn(),
            startHistogramTimer: vi.fn(() => vi.fn()),
          },
        },
      ],
    }).compile();
    producer = module.get(AnalysisRunProducer);
  });

  it('enqueues a preflight job with a stable dedupe id', async () => {
    await producer.enqueuePreflight({ runId: 'r1', userId: 'u1' });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'preflight',
      { runId: 'r1', userId: 'u1', stepKind: 'PREFLIGHT' },
      expect.objectContaining({ jobId: 'analysis:r1:preflight' }),
    );
  });

  it('enqueues an execute-stage job keyed by runId+stageKey', async () => {
    await producer.enqueueExecuteStage({
      runId: 'r1',
      userId: 'u1',
      stageKey: 'INTELLIGENCE',
    });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'execute-stage',
      {
        runId: 'r1',
        userId: 'u1',
        stepKind: 'EXECUTE_STAGE',
        stageKey: 'INTELLIGENCE',
      },
      expect.objectContaining({ jobId: 'analysis:r1:stage:INTELLIGENCE' }),
    );
  });

  it('enqueues a resume job without a stage (orchestrator decides)', async () => {
    await producer.enqueueResume({ runId: 'r1', userId: 'u1' });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'resume',
      { runId: 'r1', userId: 'u1', stepKind: 'RESUME' },
      expect.objectContaining({ jobId: 'analysis:r1:resume' }),
    );
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.producer`
Expected: FAIL — `Cannot find module '../analysis-run.producer'`.

- [ ] **Step 3: Implement the producer**

Create `apps/api/src/queue/analysis-run.producer.ts`:

```ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { AnalysisStageKey } from '@finsentinel/shared';
import { ANALYSIS_RUN_QUEUE_TOKEN } from './queue.constants';
import { MetricsService } from '../common/services/metrics.service';

export type AnalysisRunStepKind = 'PREFLIGHT' | 'EXECUTE_STAGE' | 'RESUME';

export interface AnalysisRunJobData {
  runId: string;
  userId: string;
  stepKind: AnalysisRunStepKind;
  stageKey?: AnalysisStageKey;
}

@Injectable()
export class AnalysisRunProducer {
  private readonly logger = new Logger(AnalysisRunProducer.name);

  constructor(
    @Inject(ANALYSIS_RUN_QUEUE_TOKEN) private readonly queue: Queue<AnalysisRunJobData>,
    private readonly metrics: MetricsService,
  ) {}

  async enqueuePreflight(args: { runId: string; userId: string }): Promise<void> {
    await this.queue.add(
      'preflight',
      { ...args, stepKind: 'PREFLIGHT' },
      {
        jobId: `analysis:${args.runId}:preflight`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.bumpMetrics('preflight');
  }

  async enqueueExecuteStage(args: {
    runId: string;
    userId: string;
    stageKey: AnalysisStageKey;
  }): Promise<void> {
    await this.queue.add(
      'execute-stage',
      { ...args, stepKind: 'EXECUTE_STAGE' },
      {
        jobId: `analysis:${args.runId}:stage:${args.stageKey}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.bumpMetrics('execute-stage');
  }

  async enqueueResume(args: { runId: string; userId: string }): Promise<void> {
    await this.queue.add(
      'resume',
      { ...args, stepKind: 'RESUME' },
      {
        jobId: `analysis:${args.runId}:resume`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    );
    this.bumpMetrics('resume');
  }

  private bumpMetrics(jobName: string): void {
    this.metrics.incrementCounter(
      'analysis_run_jobs_enqueued_total',
      'Total analysis-run jobs enqueued',
      { job_name: jobName },
    );
    this.metrics.setGauge(
      'analysis_run_job_enqueue_last_timestamp_seconds',
      'Timestamp of most recent analysis-run enqueue',
      { job_name: jobName },
      Date.now() / 1000,
    );
  }
}
```

- [ ] **Step 4: Verify test passes**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.producer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/analysis-run.producer.ts \
        apps/api/src/queue/__tests__/analysis-run.producer.spec.ts
git commit -m "feat(queue): AnalysisRunProducer with preflight/execute-stage/resume jobs"
```

---

## Task 12: AnalysisRunConsumer

Thin worker that delegates to `RunOrchestratorService.step(jobData)`. Keep the consumer minimal — all orchestration lives in the service so it's unit-testable without BullMQ.

**Files:**
- Create: `apps/api/src/queue/analysis-run.consumer.ts`
- Create: `apps/api/src/queue/__tests__/analysis-run.consumer.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/queue/__tests__/analysis-run.consumer.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisRunConsumer } from '../analysis-run.consumer';
import type { Job } from 'bullmq';
import type { AnalysisRunJobData } from '../analysis-run.producer';

describe('AnalysisRunConsumer.process', () => {
  let consumer: AnalysisRunConsumer;
  let orchestrator: { step: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    orchestrator = { step: vi.fn().mockResolvedValue(undefined) };
    consumer = new AnalysisRunConsumer(
      { host: 'localhost', port: 6379 } as never,
      orchestrator as never,
    );
  });

  it('delegates PREFLIGHT jobs to orchestrator.step', async () => {
    const job = {
      data: { runId: 'r1', userId: 'u1', stepKind: 'PREFLIGHT' } satisfies AnalysisRunJobData,
    } as Job<AnalysisRunJobData>;
    await consumer.process(job);
    expect(orchestrator.step).toHaveBeenCalledWith(job.data);
  });

  it('propagates orchestrator errors so BullMQ can retry', async () => {
    orchestrator.step.mockRejectedValue(new Error('boom'));
    const job = {
      data: { runId: 'r1', userId: 'u1', stepKind: 'EXECUTE_STAGE', stageKey: 'INTELLIGENCE' },
    } as Job<AnalysisRunJobData>;
    await expect(consumer.process(job)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.consumer`
Expected: FAIL — `Cannot find module '../analysis-run.consumer'`.

- [ ] **Step 3: Implement the consumer**

Create `apps/api/src/queue/analysis-run.consumer.ts`:

```ts
import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { ANALYSIS_RUN_QUEUE } from './queue.constants';
import type { AnalysisRunJobData } from './analysis-run.producer';
import { RunOrchestratorService } from '../analysis/run-orchestrator.service';

@Injectable()
export class AnalysisRunConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisRunConsumer.name);
  private worker?: Worker<AnalysisRunJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
    private readonly orchestrator: RunOrchestratorService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AnalysisRunJobData>(
      ANALYSIS_RUN_QUEUE,
      async (job) => this.process(job),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Analysis run job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });
    this.worker.on('completed', (job) => {
      this.logger.debug(`Analysis run job ${job.id} completed`);
    });
    this.logger.log('AnalysisRunConsumer worker started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.logger.log('AnalysisRunConsumer worker stopped');
  }

  async process(job: Job<AnalysisRunJobData>): Promise<void> {
    await this.orchestrator.step(job.data);
  }
}
```

- [ ] **Step 4: Verify test passes**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.consumer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/analysis-run.consumer.ts \
        apps/api/src/queue/__tests__/analysis-run.consumer.spec.ts
git commit -m "feat(queue): AnalysisRunConsumer delegates to RunOrchestratorService"
```

---

## Task 13: AnalysisRunService (CRUD + status transitions)

**Files:**
- Create: `apps/api/src/analysis/analysis-run.service.ts`
- Create: `apps/api/src/analysis/__tests__/analysis-run.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/analysis-run.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisRunService } from '../analysis-run.service';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';

// In-memory test double for Drizzle: record the last call chain and allow
// fluent `.select().from().where().limit()` + `.insert().values().returning()`
// + `.update().set().where().returning()` patterns used by the service.

describe('AnalysisRunService', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: AnalysisRunService;

  beforeEach(() => {
    db = makeFakeDb();
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
    svc = new AnalysisRunService(db as never, events as never);
  });

  it('createQueued persists a QUEUED run and emits RUN_QUEUED', async () => {
    db.__insertReturns([{ id: 'run-1', userId: 'u1', status: 'QUEUED' }]);
    const run = await svc.createQueued('u1', {
      prompt: 'analyze AAPL',
      sourceMode: 'WORKSPACE',
    });
    expect(run.id).toBe('run-1');
    expect(db.__lastInsert).toMatchObject({ userId: 'u1', status: 'QUEUED' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_QUEUED,
      expect.any(Object),
      expect.any(String),
    );
  });

  it('markRunning transitions status and emits RUN_STARTED', async () => {
    db.__updateReturns([{ id: 'run-1', status: 'RUNNING' }]);
    await svc.markRunning('u1', 'run-1');
    expect(db.__lastUpdate.set).toMatchObject({ status: 'RUNNING' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_STARTED,
      expect.any(Object),
      null,
    );
  });

  it('pause rejects when status is not RUNNING', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1', status: 'COMPLETED' }]);
    await expect(svc.pause('u1', 'run-1')).rejects.toThrow(/cannot pause/i);
  });

  it('pause transitions RUNNING -> PAUSED and emits RUN_PAUSED', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1', status: 'RUNNING' }]);
    db.__updateReturns([{ id: 'run-1', status: 'PAUSED' }]);
    await svc.pause('u1', 'run-1');
    expect(db.__lastUpdate.set).toMatchObject({ status: 'PAUSED' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_PAUSED,
      expect.any(Object),
      null,
    );
  });

  it('getForUser scopes by userId', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1' }]);
    const run = await svc.getForUser('u1', 'run-1');
    expect(run?.id).toBe('run-1');
    expect(db.__lastWhereDescriptor).toMatch(/userId/);
  });
});

function makeFakeDb() {
  let selectQueue: unknown[] = [];
  let insertQueue: unknown[] = [];
  let updateQueue: unknown[] = [];
  const fake = {
    __lastInsert: undefined as unknown,
    __lastUpdate: { set: undefined as unknown },
    __lastWhereDescriptor: '',
    __selectReturns(rows: unknown[]) { selectQueue = rows; },
    __insertReturns(rows: unknown[]) { insertQueue = rows; },
    __updateReturns(rows: unknown[]) { updateQueue = rows; },
    select: () => ({
      from: () => ({
        where: (expr: unknown) => ({
          limit: async () => {
            fake.__lastWhereDescriptor = String(expr);
            return selectQueue;
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        fake.__lastInsert = v;
        return { returning: async () => insertQueue };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        fake.__lastUpdate.set = v;
        return {
          where: () => ({ returning: async () => updateQueue }),
        };
      },
    }),
  };
  return fake;
}
```

> **Note to implementer:** this uses a hand-rolled fake, not a real Drizzle mock, to keep the test hermetic. If the repo already has a helper like `createTestDb()` in `apps/api/src/tests/`, use it and replace the fake.

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/analysis/analysis-run.service.ts`:

```ts
import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { analysisRuns, eq, and, desc } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisRunSourceMode,
  type AnalysisRunStatus,
  type CreateRunRequest,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';

interface AnalysisRunRow {
  id: string;
  userId: string;
  sourceMode: AnalysisRunSourceMode;
  status: AnalysisRunStatus;
  currentStageKey: string | null;
  inputSnapshotJson: Record<string, unknown>;
}

@Injectable()
export class AnalysisRunService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly events: AgentEventService,
  ) {}

  async createQueued(userId: string, req: CreateRunRequest): Promise<AnalysisRunRow> {
    const idempotencyKey = `run:create:${userId}:${randomUUID()}`;
    const [created] = await this.db
      .insert(analysisRuns)
      .values({
        userId,
        sourceMode: req.sourceMode,
        status: 'QUEUED',
        parentChatSessionId: req.parentChatSessionId,
        inputSnapshotJson: {
          prompt: req.prompt,
          ticker: req.ticker,
          portfolioId: req.portfolioId,
          enabledTeams: req.enabledTeams,
          researchDepth: req.researchDepth ?? 'STANDARD',
        },
      })
      .returning();
    const row = created as AnalysisRunRow;
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      row.id,
      AgentEventType.RUN_QUEUED,
      { sourceMode: req.sourceMode, prompt: req.prompt, ticker: req.ticker ?? null },
      idempotencyKey,
    );
    return row;
  }

  async getForUser(userId: string, runId: string): Promise<AnalysisRunRow | null> {
    const [row] = await this.db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)))
      .limit(1);
    return (row as AnalysisRunRow | undefined) ?? null;
  }

  async listByUser(userId: string, limit = 50): Promise<AnalysisRunRow[]> {
    return (await this.db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.userId, userId))
      .orderBy(desc(analysisRuns.createdAt))
      .limit(limit)) as AnalysisRunRow[];
  }

  async markRunning(userId: string, runId: string): Promise<void> {
    await this.transitionStatus(userId, runId, 'RUNNING');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_STARTED,
      {},
      null,
    );
  }

  async pause(userId: string, runId: string): Promise<void> {
    const row = await this.requireRun(userId, runId);
    if (row.status !== 'RUNNING') {
      throw new BadRequestException(`Cannot pause run in status ${row.status}`);
    }
    await this.transitionStatus(userId, runId, 'PAUSED');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_PAUSED,
      {},
      null,
    );
  }

  async resume(userId: string, runId: string): Promise<void> {
    const row = await this.requireRun(userId, runId);
    if (row.status !== 'PAUSED') {
      throw new BadRequestException(`Cannot resume run in status ${row.status}`);
    }
    await this.transitionStatus(userId, runId, 'RUNNING');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_RESUMED,
      {},
      null,
    );
  }

  async cancel(userId: string, runId: string): Promise<void> {
    const row = await this.requireRun(userId, runId);
    if (row.status === 'COMPLETED' || row.status === 'CANCELED') {
      throw new BadRequestException(`Run already ${row.status}`);
    }
    await this.transitionStatus(userId, runId, 'CANCELED');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_CANCELED,
      {},
      null,
    );
  }

  async markFailed(userId: string, runId: string, error: string): Promise<void> {
    await this.transitionStatus(userId, runId, 'FAILED');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_FAILED,
      { error },
      null,
    );
  }

  async markCompleted(userId: string, runId: string): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)));
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_COMPLETED,
      {},
      null,
    );
  }

  async setCurrentStage(
    userId: string,
    runId: string,
    stageKey: string,
  ): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({ currentStageKey: stageKey, updatedAt: new Date() })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)));
  }

  private async requireRun(userId: string, runId: string): Promise<AnalysisRunRow> {
    const row = await this.getForUser(userId, runId);
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    return row;
  }

  private async transitionStatus(
    userId: string,
    runId: string,
    status: AnalysisRunStatus,
  ): Promise<void> {
    await this.db
      .update(analysisRuns)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/analysis/analysis-run.service.ts \
        apps/api/src/analysis/__tests__/analysis-run.service.spec.ts
git commit -m "feat(analysis): AnalysisRunService with status lifecycle + event dual-write"
```

---

## Task 14: AnalysisCheckpointService

Responsible for stage commits (structured output + human report + checkpointVersion++ + artifact writes + event emission). This is the **barrier** that keeps the dual-write invariant tight.

**Files:**
- Create: `apps/api/src/analysis/analysis-checkpoint.service.ts`
- Create: `apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';

function makeDb() {
  const state = {
    lastStageUpdateSet: undefined as Record<string, unknown> | undefined,
    lastArtifactInsert: undefined as Record<string, unknown> | undefined,
    stageRow: { id: 'stage-1', checkpointVersion: 0, status: 'RUNNING' },
  };
  const db = {
    state,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [state.stageRow],
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.lastStageUpdateSet = v;
        return {
          where: () => ({ returning: async () => [{ ...state.stageRow, ...v }] }),
        };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.lastArtifactInsert = v;
        return { returning: async () => [{ id: 'art-1', ...v }] };
      },
    }),
  };
  return db;
}

describe('AnalysisCheckpointService.commitStage', () => {
  let db: ReturnType<typeof makeDb>;
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: AnalysisCheckpointService;

  beforeEach(() => {
    db = makeDb();
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
    svc = new AnalysisCheckpointService(db as never, events as never);
  });

  const structuredOutput = {
    summary: 's',
    thesis: 't',
    risks: [],
    openQuestions: [],
    citations: [],
    confidence: 0.8,
  };

  it('marks the stage COMPLETED, bumps checkpointVersion, and inserts 2 artifacts', async () => {
    await svc.commitStage({
      userId: 'u1',
      runId: 'r1',
      stageKey: 'INTELLIGENCE',
      structuredOutput,
      humanReportMarkdown: '# report',
    });
    expect(db.state.lastStageUpdateSet).toMatchObject({
      status: 'COMPLETED',
      checkpointVersion: 1,
      structuredOutputJson: structuredOutput,
      humanReportMarkdown: '# report',
    });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'r1',
      AgentEventType.STAGE_CHECKPOINT_COMMITTED,
      expect.objectContaining({ stageKey: 'INTELLIGENCE', checkpointVersion: 1 }),
      null,
    );
  });

  it('rejects payloads that fail schema validation', async () => {
    await expect(
      svc.commitStage({
        userId: 'u1',
        runId: 'r1',
        stageKey: 'INTELLIGENCE',
        structuredOutput: { summary: 's' } as never,
        humanReportMarkdown: '',
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- analysis-checkpoint`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/analysis/analysis-checkpoint.service.ts`:

```ts
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import {
  analysisStages,
  analysisArtifacts,
  eq,
  and,
} from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type StageStructuredOutput,
  stageStructuredOutputSchema,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';

interface CommitStageArgs {
  userId: string;
  runId: string;
  stageKey: AnalysisStageKey;
  structuredOutput: StageStructuredOutput;
  humanReportMarkdown: string;
}

interface StageRow {
  id: string;
  checkpointVersion: number;
}

@Injectable()
export class AnalysisCheckpointService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly events: AgentEventService,
  ) {}

  async startStage(runId: string, stageKey: AnalysisStageKey): Promise<string> {
    const [stage] = await this.db
      .insert(analysisStages)
      .values({
        runId,
        stageKey,
        status: 'RUNNING',
        startedAt: new Date(),
        checkpointVersion: 0,
      })
      .returning();
    return (stage as StageRow).id;
  }

  async commitStage(args: CommitStageArgs): Promise<void> {
    // Validate the handoff contract before persisting.
    const parsed = stageStructuredOutputSchema.parse(args.structuredOutput);

    const [stage] = await this.db
      .select()
      .from(analysisStages)
      .where(
        and(
          eq(analysisStages.runId, args.runId),
          eq(analysisStages.stageKey, args.stageKey),
        ),
      )
      .limit(1);
    if (!stage) {
      throw new NotFoundException(
        `Stage ${args.stageKey} not found for run ${args.runId}`,
      );
    }
    const row = stage as StageRow;
    const nextVersion = row.checkpointVersion + 1;

    // Materialized state update
    await this.db
      .update(analysisStages)
      .set({
        status: 'COMPLETED',
        checkpointVersion: nextVersion,
        structuredOutputJson: parsed,
        humanReportMarkdown: args.humanReportMarkdown,
        completedAt: new Date(),
      })
      .where(eq(analysisStages.id, row.id));

    // Artifact writes: 1 JSON + 1 markdown
    await this.db.insert(analysisArtifacts).values({
      runId: args.runId,
      stageId: row.id,
      artifactKind: 'STAGE_STRUCTURED_OUTPUT',
      artifactName: `${args.stageKey.toLowerCase()}-structured.json`,
      mimeType: 'application/json',
      payloadJson: parsed,
    });
    await this.db.insert(analysisArtifacts).values({
      runId: args.runId,
      stageId: row.id,
      artifactKind: 'STAGE_HUMAN_REPORT',
      artifactName: `${args.stageKey.toLowerCase()}-report.md`,
      mimeType: 'text/markdown',
      payloadJson: { markdown: args.humanReportMarkdown },
    });

    // Event dual-write
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      AgentEventType.STAGE_CHECKPOINT_COMMITTED,
      { stageKey: args.stageKey, checkpointVersion: nextVersion },
      null,
    );
  }

  async markStageFailed(
    userId: string,
    runId: string,
    stageKey: AnalysisStageKey,
    error: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(analysisStages)
      .set({ status: 'FAILED', errorJson: error, completedAt: new Date() })
      .where(
        and(eq(analysisStages.runId, runId), eq(analysisStages.stageKey, stageKey)),
      );
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.RUN_FAILED,
      { stageKey, error },
      null,
    );
  }
}
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- analysis-checkpoint`
Expected: PASS.

```bash
git add apps/api/src/analysis/analysis-checkpoint.service.ts \
        apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts
git commit -m "feat(analysis): AnalysisCheckpointService with stage commit + artifact dual-write"
```

---

## Task 15: AnalysisApprovalService

Tracks the Execution Prep → Human Approval handoff. `request()` stores the `PENDING` row + emits `EXECUTION_APPROVAL_REQUIRED`; `resolve()` flips `APPROVED` or `REJECTED` and emits the respective event.

**Files:**
- Create: `apps/api/src/analysis/analysis-approval.service.ts`
- Create: `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisApprovalService } from '../analysis-approval.service';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';

const payload = {
  orderDrafts: [
    {
      draftId: '11111111-1111-1111-1111-111111111111',
      portfolioIntent: 'OPEN',
      assetType: 'EQUITY',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: { mode: 'SHARES', value: 100 },
      orderType: 'MARKET',
      limitPrice: null,
      stopPrice: null,
      timeInForce: 'DAY',
      thesisRef: 'artifact-t',
      riskRef: 'artifact-r',
      maxSlippageBps: 50,
      maxPositionPercent: 5,
      brokerConstraints: { allowFractional: false, extendedHours: false },
      approvalRequired: true,
      warnings: [],
    },
  ],
};

function makeDb(approvalRow: Record<string, unknown> | null = null) {
  const state = {
    lastInsert: undefined as Record<string, unknown> | undefined,
    lastUpdateSet: undefined as Record<string, unknown> | undefined,
    row: approvalRow,
  };
  return {
    state,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.lastInsert = v;
        return { returning: async () => [{ id: 'appr-1', ...v }] };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.row ? [state.row] : []) }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.lastUpdateSet = v;
        return { where: () => ({ returning: async () => [{ id: 'appr-1', ...v }] }) };
      },
    }),
  };
}

describe('AnalysisApprovalService', () => {
  let events: { append: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
  });

  it('request() creates a PENDING approval and emits EXECUTION_APPROVAL_REQUIRED', async () => {
    const db = makeDb();
    const svc = new AnalysisApprovalService(db as never, events as never);
    const row = await svc.request({
      userId: 'u1',
      runId: 'r1',
      payload,
    });
    expect(row.id).toBe('appr-1');
    expect(db.state.lastInsert).toMatchObject({
      runId: 'r1',
      approvalType: 'EXECUTION_APPROVAL',
      status: 'PENDING',
    });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      'appr-1',
      AgentEventType.EXECUTION_APPROVAL_REQUIRED,
      expect.any(Object),
      expect.any(String),
    );
  });

  it('request() rejects payloads that fail OrderDraft schema', async () => {
    const db = makeDb();
    const svc = new AnalysisApprovalService(db as never, events as never);
    await expect(
      svc.request({ userId: 'u1', runId: 'r1', payload: { orderDrafts: [{}] } as never }),
    ).rejects.toThrow();
  });

  it('resolve(APPROVE) flips status and emits EXECUTION_APPROVED', async () => {
    const db = makeDb({ id: 'appr-1', runId: 'r1', status: 'PENDING' });
    const svc = new AnalysisApprovalService(db as never, events as never);
    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });
    expect(db.state.lastUpdateSet).toMatchObject({ status: 'APPROVED' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      'appr-1',
      AgentEventType.EXECUTION_APPROVED,
      expect.any(Object),
      null,
    );
  });

  it('resolve() on non-PENDING row throws', async () => {
    const db = makeDb({ id: 'appr-1', runId: 'r1', status: 'APPROVED' });
    const svc = new AnalysisApprovalService(db as never, events as never);
    await expect(
      svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' }),
    ).rejects.toThrow(/already resolved/i);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- analysis-approval`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/analysis/analysis-approval.service.ts`:

```ts
import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { analysisApprovals, eq, and } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import {
  AgentEventAggregateType,
  AgentEventType,
  orderDraftsPayloadSchema,
  type OrderDraftsPayload,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';

export type ApprovalDecision = 'APPROVE' | 'REJECT';

interface ApprovalRow {
  id: string;
  runId: string;
  status: string;
  requestedPayloadJson: Record<string, unknown>;
}

@Injectable()
export class AnalysisApprovalService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly events: AgentEventService,
  ) {}

  async request(args: {
    userId: string;
    runId: string;
    payload: OrderDraftsPayload;
  }): Promise<ApprovalRow> {
    // Broker-neutral validation MUST happen before persisting.
    const parsed = orderDraftsPayloadSchema.parse(args.payload);
    const [row] = await this.db
      .insert(analysisApprovals)
      .values({
        runId: args.runId,
        approvalType: 'EXECUTION_APPROVAL',
        status: 'PENDING',
        requestedPayloadJson: parsed as unknown as Record<string, unknown>,
      })
      .returning();
    const created = row as ApprovalRow;
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      created.id,
      AgentEventType.EXECUTION_APPROVAL_REQUIRED,
      { runId: args.runId, draftCount: parsed.orderDrafts.length },
      `approval:request:${created.id}`,
    );
    return created;
  }

  async resolve(args: {
    userId: string;
    approvalId: string;
    decision: ApprovalDecision;
    note?: string;
  }): Promise<void> {
    const [row] = await this.db
      .select()
      .from(analysisApprovals)
      .where(eq(analysisApprovals.id, args.approvalId))
      .limit(1);
    if (!row) throw new NotFoundException(`Approval ${args.approvalId} not found`);
    const existing = row as ApprovalRow;
    if (existing.status !== 'PENDING') {
      throw new BadRequestException(`Approval already resolved: ${existing.status}`);
    }
    const newStatus = args.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.db
      .update(analysisApprovals)
      .set({
        status: newStatus,
        approvedPayloadJson:
          args.decision === 'APPROVE' ? existing.requestedPayloadJson : null,
        resolvedAt: new Date(),
        resolvedByUserId: args.userId,
      })
      .where(eq(analysisApprovals.id, args.approvalId));
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      args.approvalId,
      args.decision === 'APPROVE'
        ? AgentEventType.EXECUTION_APPROVED
        : AgentEventType.EXECUTION_REJECTED,
      { note: args.note ?? null },
      null,
    );
  }

  async listForRun(runId: string): Promise<ApprovalRow[]> {
    return (await this.db
      .select()
      .from(analysisApprovals)
      .where(eq(analysisApprovals.runId, runId))) as ApprovalRow[];
  }
}
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- analysis-approval`
Expected: PASS.

```bash
git add apps/api/src/analysis/analysis-approval.service.ts \
        apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts
git commit -m "feat(analysis): AnalysisApprovalService with PENDING->APPROVED/REJECTED lifecycle"
```

---

## Task 16: PreflightPlannerService + ContextComplexityService

These two live together because complexity estimation is the core of the preflight gate. Split into two services because `ContextComplexityService` is pure (easy to unit test) and `PreflightPlannerService` wraps the decision with event emission + upgrade-reason derivation.

**Files:**
- Create: `apps/api/src/analysis/context-complexity.service.ts`
- Create: `apps/api/src/analysis/preflight-planner.service.ts`
- Create: `apps/api/src/analysis/__tests__/preflight-planner.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/preflight-planner.service.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ContextComplexityService } from '../context-complexity.service';
import { PreflightPlannerService } from '../preflight-planner.service';

describe('ContextComplexityService.estimate', () => {
  const svc = new ContextComplexityService();

  it('lightweight query stays below all thresholds', () => {
    const est = svc.estimate({ prompt: 'What is the current price of AAPL?' });
    expect(est.upgradeRecommended).toBe(false);
    expect(est.predictedToolCalls).toBeLessThan(6);
  });

  it('"complete analysis" phrasing forces upgrade via intent', () => {
    const est = svc.estimate({ prompt: 'Give me a complete analysis of AAPL' });
    expect(est.upgradeRecommended).toBe(true);
    expect(est.upgradeReason).toMatch(/complete analysis|intent/i);
  });

  it('"generate order draft" phrasing forces upgrade', () => {
    const est = svc.estimate({ prompt: 'Generate an order draft for TSLA' });
    expect(est.upgradeRecommended).toBe(true);
  });

  it('tool-call threshold triggers upgrade', () => {
    const est = svc.estimate({
      prompt:
        'Analyze AAPL valuation and compare to MSFT, GOOGL, META, AMZN across fundamentals and technicals',
    });
    expect(est.predictedToolCalls).toBeGreaterThanOrEqual(6);
    expect(est.upgradeRecommended).toBe(true);
  });
});

describe('PreflightPlannerService', () => {
  const planner = new PreflightPlannerService(new ContextComplexityService());

  it('decide() returns the estimate and a human-readable reason', async () => {
    const out = await planner.decide({ prompt: 'Complete analysis of AAPL' });
    expect(out.upgradeRecommended).toBe(true);
    expect(out.upgradeReason.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- preflight-planner`
Expected: FAIL.

- [ ] **Step 3: Implement ContextComplexityService**

Create `apps/api/src/analysis/context-complexity.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { ComplexityEstimate } from '@finsentinel/shared';

/**
 * Rule-of-thumb complexity estimator used by the preflight gate.
 *
 * Thresholds match the v1 PRD: upgrade when any of
 *   predictedToolCalls >= 6
 *   predictedToolRounds >= 3
 *   predictedWallClockSec >= 20
 * or the prompt contains an explicit upgrade intent.
 */
@Injectable()
export class ContextComplexityService {
  private static readonly TOOL_CALL_THRESHOLD = 6;
  private static readonly TOOL_ROUNDS_THRESHOLD = 3;
  private static readonly WALL_CLOCK_THRESHOLD = 20;

  private static readonly INTENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
    { re: /complete analysis/i, label: 'complete analysis' },
    { re: /full analysis/i, label: 'full analysis' },
    { re: /form (a )?decision|decision formation/i, label: 'decision formation' },
    { re: /order draft|generate (an )?order/i, label: 'order draft generation' },
  ];

  estimate(input: { prompt: string }): ComplexityEstimate {
    const prompt = input.prompt.trim();

    // Intent-based upgrade.
    for (const { re, label } of ContextComplexityService.INTENT_PATTERNS) {
      if (re.test(prompt)) {
        return {
          predictedToolCalls: 8,
          predictedToolRounds: 4,
          predictedWallClockSec: 25,
          upgradeRecommended: true,
          upgradeReason: `intent:${label}`,
        };
      }
    }

    // Heuristic-based upgrade. Count tickers and comparison markers.
    const tickerMatches = prompt.match(/\b[A-Z]{2,5}(?:-[A-Z]+)?\b/g) ?? [];
    const tickerCount = new Set(tickerMatches).size;
    const comparisonPenalty = /compare|vs|against/i.test(prompt) ? 2 : 0;
    const depthSignals =
      (/fundamental/i.test(prompt) ? 1 : 0) +
      (/technical/i.test(prompt) ? 1 : 0) +
      (/sentiment/i.test(prompt) ? 1 : 0) +
      (/valuation|dcf|multiples?/i.test(prompt) ? 1 : 0);
    const predictedToolCalls = Math.min(
      1 + tickerCount + comparisonPenalty + depthSignals,
      20,
    );
    const predictedToolRounds = Math.max(1, Math.ceil(predictedToolCalls / 3));
    const predictedWallClockSec = 3 + predictedToolCalls * 2.5;

    const upgrade =
      predictedToolCalls >= ContextComplexityService.TOOL_CALL_THRESHOLD ||
      predictedToolRounds >= ContextComplexityService.TOOL_ROUNDS_THRESHOLD ||
      predictedWallClockSec >= ContextComplexityService.WALL_CLOCK_THRESHOLD;

    return {
      predictedToolCalls,
      predictedToolRounds,
      predictedWallClockSec,
      upgradeRecommended: upgrade,
      upgradeReason: upgrade
        ? `heuristic:calls=${predictedToolCalls},rounds=${predictedToolRounds},sec=${predictedWallClockSec.toFixed(1)}`
        : 'below-threshold',
    };
  }
}
```

- [ ] **Step 4: Implement PreflightPlannerService**

Create `apps/api/src/analysis/preflight-planner.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { ComplexityEstimate } from '@finsentinel/shared';
import { ContextComplexityService } from './context-complexity.service';

@Injectable()
export class PreflightPlannerService {
  constructor(private readonly complexity: ContextComplexityService) {}

  async decide(input: { prompt: string }): Promise<ComplexityEstimate> {
    return this.complexity.estimate(input);
  }
}
```

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- preflight-planner`
Expected: PASS.

```bash
git add apps/api/src/analysis/context-complexity.service.ts \
        apps/api/src/analysis/preflight-planner.service.ts \
        apps/api/src/analysis/__tests__/preflight-planner.service.spec.ts
git commit -m "feat(analysis): ContextComplexityService + PreflightPlannerService with v1 thresholds"
```

---

## Task 17: ContextFabricService

Assembles the four-layer shared context and produces both machine-readable and prompt-ready forms. v1 implementation stays read-only — it pulls from existing stores (user investment profile, chat compaction memory, RAG retrieval) and stitches them into the 4-layer shape. Plan B and C extend this with team-level inputs.

**Files:**
- Create: `apps/api/src/analysis/context-fabric.service.ts`
- Create: `apps/api/src/analysis/__tests__/context-fabric.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/context-fabric.service.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ContextFabricService } from '../context-fabric.service';
import { sharedContextSchema } from '@finsentinel/shared';

describe('ContextFabricService.assemble', () => {
  it('returns a schema-valid SharedContext with 4 populated layers', async () => {
    const profile = { load: vi.fn().mockResolvedValue('long-term pref text') };
    const strategy = { load: vi.fn().mockResolvedValue('mid-term strat text') };
    const compaction = { load: vi.fn().mockResolvedValue({ summary: 'session sum', count: 3 }) };
    const rag = {
      retrieve: vi.fn().mockResolvedValue([
        { id: 'doc-1', snippet: 'ret 1' },
        { id: 'doc-2', snippet: 'ret 2' },
      ]),
    };

    const svc = new ContextFabricService(
      profile as never,
      strategy as never,
      compaction as never,
      rag as never,
    );

    const ctx = await svc.assemble({
      userId: 'u1',
      sessionId: 's1',
      prompt: 'analyze AAPL',
    });

    const parsed = sharedContextSchema.parse(ctx);
    expect(parsed.longTermPreferenceContext.summary).toBe('long-term pref text');
    expect(parsed.midTermStrategyContext.summary).toBe('mid-term strat text');
    expect(parsed.shortTermSessionContext.summary).toContain('session sum');
    expect(parsed.retrievalContext.sourceIds).toEqual(['doc-1', 'doc-2']);
  });

  it('toPromptReady() produces a deterministic text format with layer headers', async () => {
    const svc = new ContextFabricService(
      { load: vi.fn().mockResolvedValue('A') } as never,
      { load: vi.fn().mockResolvedValue('B') } as never,
      { load: vi.fn().mockResolvedValue({ summary: 'C', count: 0 }) } as never,
      { retrieve: vi.fn().mockResolvedValue([]) } as never,
    );
    const ctx = await svc.assemble({ userId: 'u1', sessionId: 's1', prompt: 'x' });
    const text = svc.toPromptReady(ctx);
    expect(text).toMatch(/## Long-term preference/);
    expect(text).toMatch(/## Mid-term strategy/);
    expect(text).toMatch(/## Short-term session/);
    expect(text).toMatch(/## Retrieved evidence/);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- context-fabric`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/analysis/context-fabric.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { SharedContext, ContextLayer } from '@finsentinel/shared';
import { UserInvestmentProfileService } from '../agent/user-investment-profile.service';
import { AgentBrainService } from '../agent/agent-brain.service';
import { ChatCompactionService } from '../chat/chat-compaction.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';

interface AssembleArgs {
  userId: string;
  sessionId?: string;
  prompt: string;
  portfolioId?: string;
}

/**
 * v1 interfaces for loader dependencies — each just returns a text summary.
 * We declare them here so tests can pass plain mocks without importing the
 * real NestJS services.
 */
export interface LongTermLoader {
  load(userId: string): Promise<string>;
}
export interface MidTermLoader {
  load(userId: string, portfolioId?: string): Promise<string>;
}
export interface SessionLoader {
  load(userId: string, sessionId: string | undefined): Promise<{
    summary: string;
    count: number;
  }>;
}
export interface RetrievalLoader {
  retrieve(
    query: string,
    args: { userId: string; limit?: number },
  ): Promise<Array<{ id: string; snippet: string }>>;
}

@Injectable()
export class ContextFabricService {
  private readonly logger = new Logger(ContextFabricService.name);

  constructor(
    private readonly longTerm: LongTermLoader | UserInvestmentProfileService,
    private readonly midTerm: MidTermLoader | AgentBrainService,
    private readonly session: SessionLoader | ChatCompactionService,
    private readonly retrieval: RetrievalLoader | RagRetrievalService,
  ) {}

  async assemble(args: AssembleArgs): Promise<SharedContext> {
    const [longSummary, midSummary, sessionSummary, retrieved] = await Promise.all([
      this.safeLoadLong(args.userId),
      this.safeLoadMid(args.userId, args.portfolioId),
      this.safeLoadSession(args.userId, args.sessionId),
      this.safeRetrieve(args.prompt, args.userId),
    ]);
    const now = new Date().toISOString();

    return {
      longTermPreferenceContext: this.layer(longSummary, [], now),
      midTermStrategyContext: this.layer(midSummary, [], now),
      shortTermSessionContext: this.layer(
        `${sessionSummary.summary} (compacted=${sessionSummary.count})`,
        [],
        now,
      ),
      retrievalContext: this.layer(
        retrieved.map((r) => r.snippet).join('\n---\n'),
        retrieved.map((r) => r.id),
        now,
      ),
    };
  }

  toPromptReady(ctx: SharedContext): string {
    return [
      '## Long-term preference',
      ctx.longTermPreferenceContext.summary || '(empty)',
      '',
      '## Mid-term strategy',
      ctx.midTermStrategyContext.summary || '(empty)',
      '',
      '## Short-term session',
      ctx.shortTermSessionContext.summary || '(empty)',
      '',
      '## Retrieved evidence',
      ctx.retrievalContext.summary || '(empty)',
    ].join('\n');
  }

  private layer(summary: string, sourceIds: string[], updatedAt: string): ContextLayer {
    return { summary, sourceIds, updatedAt };
  }

  private async safeLoadLong(userId: string): Promise<string> {
    try {
      const l = this.longTerm as LongTermLoader;
      return await l.load(userId);
    } catch (err) {
      this.logger.warn(`long-term load failed: ${err}`);
      return '';
    }
  }
  private async safeLoadMid(userId: string, portfolioId?: string): Promise<string> {
    try {
      const l = this.midTerm as MidTermLoader;
      return await l.load(userId, portfolioId);
    } catch (err) {
      this.logger.warn(`mid-term load failed: ${err}`);
      return '';
    }
  }
  private async safeLoadSession(
    userId: string,
    sessionId: string | undefined,
  ): Promise<{ summary: string; count: number }> {
    if (!sessionId) return { summary: '', count: 0 };
    try {
      const l = this.session as SessionLoader;
      return await l.load(userId, sessionId);
    } catch (err) {
      this.logger.warn(`session load failed: ${err}`);
      return { summary: '', count: 0 };
    }
  }
  private async safeRetrieve(
    prompt: string,
    userId: string,
  ): Promise<Array<{ id: string; snippet: string }>> {
    try {
      const l = this.retrieval as RetrievalLoader;
      return await l.retrieve(prompt, { userId, limit: 8 });
    } catch (err) {
      this.logger.warn(`retrieval failed: ${err}`);
      return [];
    }
  }
}
```

> **Integration note for Plan B/C:** the existing services (`UserInvestmentProfileService`, `AgentBrainService`, `ChatCompactionService`, `RagRetrievalService`) may not expose the exact methods `load()`/`retrieve()` this service expects. Plan A leaves those as structural type intersections so tests can use lightweight stubs. When wiring into `AnalysisModule` (Task 20), adapt the concrete services by creating thin adapter providers that satisfy the `Loader` interfaces. Do NOT change the existing service signatures — instead define adapters inside `analysis.module.ts`.

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- context-fabric`
Expected: PASS.

```bash
git add apps/api/src/analysis/context-fabric.service.ts \
        apps/api/src/analysis/__tests__/context-fabric.service.spec.ts
git commit -m "feat(analysis): ContextFabricService assembles 4-layer shared context"
```

---

## Task 18: RunOrchestratorService (skeleton)

This is the consumer-side brain. Plan A ships the skeleton with PREFLIGHT + basic stage enqueue handling. Plan B fills in the team execution logic. Plan C hooks the entry points.

**Files:**
- Create: `apps/api/src/analysis/run-orchestrator.service.ts`

- [ ] **Step 1: Implement the skeleton**

Create `apps/api/src/analysis/run-orchestrator.service.ts`:

```ts
import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import type { AnalysisStageKey } from '@finsentinel/shared';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';
import type { AnalysisRunJobData } from '../queue/analysis-run.producer';

const TEAM_STAGE_ORDER: AnalysisStageKey[] = [
  'INTELLIGENCE',
  'THESIS',
  'RISK',
  'EXECUTION_PREP',
  'HUMAN_APPROVAL',
];

/**
 * Step-driven orchestrator. Each BullMQ job invokes `step(data)`. This class
 * owns the state machine; team-level execution is injected by Plan B via
 * `registerStageExecutor`.
 */
@Injectable()
export class RunOrchestratorService {
  private readonly logger = new Logger(RunOrchestratorService.name);
  private readonly stageExecutors = new Map<
    AnalysisStageKey,
    (args: { runId: string; userId: string }) => Promise<void>
  >();

  constructor(
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    @Inject(forwardRef(() => AnalysisRunProducer))
    private readonly producer: AnalysisRunProducer,
  ) {}

  /**
   * Plan B calls this once per team service during module init.
   */
  registerStageExecutor(
    stageKey: AnalysisStageKey,
    executor: (args: { runId: string; userId: string }) => Promise<void>,
  ): void {
    this.stageExecutors.set(stageKey, executor);
  }

  async step(data: AnalysisRunJobData): Promise<void> {
    switch (data.stepKind) {
      case 'PREFLIGHT':
        await this.handlePreflight(data);
        return;
      case 'EXECUTE_STAGE':
        await this.handleExecuteStage(data);
        return;
      case 'RESUME':
        await this.handleResume(data);
        return;
    }
  }

  private async handlePreflight(data: AnalysisRunJobData): Promise<void> {
    await this.runs.markRunning(data.userId, data.runId);
    await this.runs.setCurrentStage(data.userId, data.runId, TEAM_STAGE_ORDER[0]!);
    await this.producer.enqueueExecuteStage({
      runId: data.runId,
      userId: data.userId,
      stageKey: TEAM_STAGE_ORDER[0]!,
    });
  }

  private async handleExecuteStage(data: AnalysisRunJobData): Promise<void> {
    if (!data.stageKey) {
      throw new Error('execute-stage job missing stageKey');
    }
    const executor = this.stageExecutors.get(data.stageKey);
    if (!executor) {
      this.logger.warn(
        `No executor registered for stage ${data.stageKey}; skipping (Plan B adds this)`,
      );
      return;
    }
    try {
      await this.checkpoints.startStage(data.runId, data.stageKey);
      await executor({ runId: data.runId, userId: data.userId });
      const next = this.nextStage(data.stageKey);
      if (next === null) {
        await this.runs.markCompleted(data.userId, data.runId);
      } else {
        await this.runs.setCurrentStage(data.userId, data.runId, next);
        await this.producer.enqueueExecuteStage({
          runId: data.runId,
          userId: data.userId,
          stageKey: next,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.checkpoints.markStageFailed(data.userId, data.runId, data.stageKey, {
        message,
      });
      await this.runs.markFailed(data.userId, data.runId, message);
      throw err;
    }
  }

  private async handleResume(data: AnalysisRunJobData): Promise<void> {
    // Resume from the last PENDING/FAILED stage. Plan B refines this to use
    // checkpointVersion. v1 simplification: re-enqueue the current stage.
    const run = await this.runs.getForUser(data.userId, data.runId);
    if (!run?.currentStageKey) {
      await this.producer.enqueuePreflight({ runId: data.runId, userId: data.userId });
      return;
    }
    await this.producer.enqueueExecuteStage({
      runId: data.runId,
      userId: data.userId,
      stageKey: run.currentStageKey as AnalysisStageKey,
    });
  }

  private nextStage(current: AnalysisStageKey): AnalysisStageKey | null {
    const idx = TEAM_STAGE_ORDER.indexOf(current);
    if (idx === -1) return null;
    const next = TEAM_STAGE_ORDER[idx + 1];
    return next ?? null;
  }
}
```

- [ ] **Step 2: Commit**

No dedicated test — the orchestrator is exercised via consumer spec (Task 12) + integration tests in Plan D. The skeleton is deliberately thin.

```bash
git add apps/api/src/analysis/run-orchestrator.service.ts
git commit -m "feat(analysis): RunOrchestratorService skeleton with stage executor registry"
```

---

## Task 19: AnalysisRunController + AnalysisApprovalController

HTTP surface for the runtime. Plan C may add more routes; Plan A gives the minimum needed to drive Plan D's workspace.

**Files:**
- Create: `apps/api/src/analysis/analysis-run.controller.ts`
- Create: `apps/api/src/analysis/analysis-approval.controller.ts`
- Create: `apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

Create `apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisRunController } from '../analysis-run.controller';

describe('AnalysisRunController', () => {
  let runs: {
    createQueued: ReturnType<typeof vi.fn>;
    getForUser: ReturnType<typeof vi.fn>;
    listByUser: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let producer: { enqueuePreflight: ReturnType<typeof vi.fn> };
  let ctrl: AnalysisRunController;

  beforeEach(() => {
    runs = {
      createQueued: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1', status: 'QUEUED' }),
      getForUser: vi.fn(),
      listByUser: vi.fn().mockResolvedValue([]),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    producer = { enqueuePreflight: vi.fn().mockResolvedValue(undefined) };
    ctrl = new AnalysisRunController(runs as never, producer as never);
  });

  it('POST /analysis/runs creates a run and enqueues preflight', async () => {
    const res = await ctrl.create(
      { prompt: 'Analyze AAPL', sourceMode: 'WORKSPACE' },
      { sub: 'u1', email: 'u@x.com' } as never,
    );
    expect(runs.createQueued).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(producer.enqueuePreflight).toHaveBeenCalledWith({ runId: 'r1', userId: 'u1' });
    expect(res.id).toBe('r1');
  });

  it('GET /analysis/runs/:id 404s when not owned', async () => {
    runs.getForUser.mockResolvedValue(null);
    await expect(
      ctrl.getOne('r1', { sub: 'u1', email: 'u@x.com' } as never),
    ).rejects.toThrow(/not found/i);
  });

  it('POST /analysis/runs/:id/pause delegates to service', async () => {
    await ctrl.pause('r1', { sub: 'u1', email: 'u@x.com' } as never);
    expect(runs.pause).toHaveBeenCalledWith('u1', 'r1');
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.controller`
Expected: FAIL.

- [ ] **Step 3: Implement AnalysisRunController**

Create `apps/api/src/analysis/analysis-run.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { createRunRequestSchema, type CreateRunRequest } from '@finsentinel/shared';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';

@Controller('analysis/runs')
@UseGuards(JwtGuard)
export class AnalysisRunController {
  constructor(
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
  ) {}

  @Post()
  async create(@Body() body: CreateRunRequest, @CurrentUser() user: CurrentUserPayload) {
    const req = createRunRequestSchema.parse(body);
    const row = await this.runs.createQueued(user.sub, req);
    await this.producer.enqueuePreflight({ runId: row.id, userId: user.sub });
    return row;
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.runs.listByUser(user.sub);
  }

  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const row = await this.runs.getForUser(user.sub, id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    return row;
  }

  @Post(':id/pause')
  async pause(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.runs.pause(user.sub, id);
    return { ok: true };
  }

  @Post(':id/resume')
  async resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.runs.resume(user.sub, id);
    return { ok: true };
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.runs.cancel(user.sub, id);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Implement AnalysisApprovalController**

Create `apps/api/src/analysis/analysis-approval.controller.ts`:

```ts
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import {
  approveExecutionRequestSchema,
  type ApproveExecutionRequest,
} from '@finsentinel/shared';
import { AnalysisApprovalService } from './analysis-approval.service';

@Controller('analysis/approvals')
@UseGuards(JwtGuard)
export class AnalysisApprovalController {
  constructor(private readonly approvals: AnalysisApprovalService) {}

  @Post(':id/resolve')
  async resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ApproveExecutionRequest,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const parsed = approveExecutionRequestSchema.parse(body);
    await this.approvals.resolve({
      userId: user.sub,
      approvalId: id,
      decision: parsed.decision,
      note: parsed.note,
    });
    return { ok: true };
  }
}
```

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- analysis-run.controller`
Expected: PASS.

```bash
git add apps/api/src/analysis/analysis-run.controller.ts \
        apps/api/src/analysis/analysis-approval.controller.ts \
        apps/api/src/analysis/__tests__/analysis-run.controller.spec.ts
git commit -m "feat(analysis): run + approval REST controllers"
```

---

## Task 20: Wire Everything Into AnalysisModule + QueueModule

**Files:**
- Modify: `apps/api/src/analysis/analysis.module.ts`
- Modify: `apps/api/src/queue/queue.module.ts`

- [ ] **Step 1: Rewrite analysis.module.ts**

Replace `apps/api/src/analysis/analysis.module.ts` with:

```ts
import { Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { ChatModule } from '../chat/chat.module';
import { EventsModule } from '../events/events.module';
import { RagModule } from '../rag/rag.module';
import { QueueModule } from '../queue/queue.module';

import { AnalysisController } from './analysis.controller';
import { AnalysisRunController } from './analysis-run.controller';
import { AnalysisApprovalController } from './analysis-approval.controller';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { AnalysisApprovalService } from './analysis-approval.service';
import { ContextComplexityService } from './context-complexity.service';
import { PreflightPlannerService } from './preflight-planner.service';
import { ContextFabricService } from './context-fabric.service';
import { RunOrchestratorService } from './run-orchestrator.service';

// Adapters implement the ContextFabric loader interfaces on top of existing
// services. Keep them inline here so we don't bend existing service APIs.
import { UserInvestmentProfileService } from '../agent/user-investment-profile.service';
import { AgentBrainService } from '../agent/agent-brain.service';
import { ChatCompactionService } from '../chat/chat-compaction.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';

@Module({
  imports: [
    AgentModule,
    AuthModule,
    CommonModule,
    ChatModule,
    EventsModule,
    RagModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [AnalysisController, AnalysisRunController, AnalysisApprovalController],
  providers: [
    AnalysisRunService,
    AnalysisCheckpointService,
    AnalysisApprovalService,
    ContextComplexityService,
    PreflightPlannerService,
    RunOrchestratorService,
    {
      provide: ContextFabricService,
      useFactory: (
        profile: UserInvestmentProfileService,
        brain: AgentBrainService,
        compaction: ChatCompactionService,
        rag: RagRetrievalService,
      ) => {
        // Thin adapters — each delegates to whichever method the underlying
        // service currently exposes. Adjust here if signatures differ.
        const longAdapter = {
          load: async (userId: string) =>
            (await (profile as unknown as { getSummary(u: string): Promise<string> })
              .getSummary(userId)) ?? '',
        };
        const midAdapter = {
          load: async (userId: string) =>
            (await (brain as unknown as { getStrategySummary(u: string): Promise<string> })
              .getStrategySummary(userId)) ?? '',
        };
        const sessionAdapter = {
          load: async (userId: string, sessionId: string | undefined) => {
            if (!sessionId) return { summary: '', count: 0 };
            const summary =
              (await (compaction as unknown as {
                getSessionSummary(u: string, s: string): Promise<{ text: string; count: number } | null>;
              }).getSessionSummary(userId, sessionId)) ?? null;
            return {
              summary: summary?.text ?? '',
              count: summary?.count ?? 0,
            };
          },
        };
        const ragAdapter = {
          retrieve: async (
            query: string,
            args: { userId: string; limit?: number },
          ) => {
            const hits = await (
              rag as unknown as {
                search(q: string, o: { userId: string; limit?: number }): Promise<
                  Array<{ id: string; text: string }>
                >;
              }
            ).search(query, { userId: args.userId, limit: args.limit });
            return (hits ?? []).map((h) => ({ id: h.id, snippet: h.text }));
          },
        };
        return new ContextFabricService(
          longAdapter,
          midAdapter,
          sessionAdapter,
          ragAdapter,
        );
      },
      inject: [
        UserInvestmentProfileService,
        AgentBrainService,
        ChatCompactionService,
        RagRetrievalService,
      ],
    },
  ],
  exports: [
    AnalysisRunService,
    AnalysisCheckpointService,
    AnalysisApprovalService,
    ContextFabricService,
    PreflightPlannerService,
    RunOrchestratorService,
  ],
})
export class AnalysisModule {}
```

> **Implementer note:** the adapter factory above assumes `UserInvestmentProfileService.getSummary`, `AgentBrainService.getStrategySummary`, `ChatCompactionService.getSessionSummary`, and `RagRetrievalService.search` exist. If they don't under those exact names, read the service files, pick the closest existing method, and rewrite the adapter body. Do NOT add new methods to those services in Plan A — adapters only.

- [ ] **Step 2: Update queue.module.ts to import forwardRef(AnalysisModule)**

Edit `apps/api/src/queue/queue.module.ts`. Import:
```ts
import { AnalysisModule } from '../analysis/analysis.module';
```

Add to `imports`:
```ts
    forwardRef(() => AnalysisModule),
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @finsentinel/api typecheck`
Expected: no errors. If adapter methods are wrong, fix them in the factory body only.

```bash
git add apps/api/src/analysis/analysis.module.ts apps/api/src/queue/queue.module.ts
git commit -m "feat(analysis): wire runtime services + context fabric into AnalysisModule"
```

---

## Task 21: Feature Flag `ANALYSIS_RUNS_ENABLED`

Plan B, C, D gate behavior behind this flag so Plan A can land without breaking prod.

**Files:**
- Modify: `apps/api/src/config/env.validation.ts`

- [ ] **Step 1: Add the flag**

Edit `apps/api/src/config/env.validation.ts`. Add to the Zod schema near the other `_ENABLED` flags:

```ts
  ANALYSIS_RUNS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default('false'),
  CHAT_AUTO_UPGRADE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default('false'),
```

- [ ] **Step 2: Add a validator test case**

Edit `apps/api/src/config/__tests__/env.validation.spec.ts` to include:

```ts
it('ANALYSIS_RUNS_ENABLED defaults to false', () => {
  const parsed = envValidationSchema.parse({
    // ...fill in whatever required fields the existing test covers...
  });
  expect(parsed.ANALYSIS_RUNS_ENABLED).toBe(false);
});

it('ANALYSIS_RUNS_ENABLED=true is truthy', () => {
  const parsed = envValidationSchema.parse({
    ANALYSIS_RUNS_ENABLED: 'true',
    // ...other required fields...
  });
  expect(parsed.ANALYSIS_RUNS_ENABLED).toBe(true);
});
```

(Read the existing spec file first to copy its required-fields boilerplate — do not invent new fields.)

- [ ] **Step 3: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- env.validation`
Expected: PASS.

```bash
git add apps/api/src/config/env.validation.ts apps/api/src/config/__tests__/env.validation.spec.ts
git commit -m "feat(config): add ANALYSIS_RUNS_ENABLED + CHAT_AUTO_UPGRADE_ENABLED flags"
```

---

## Task 22: Full API Typecheck + Plan-A Test Sweep

**Files:** none (verification only).

- [ ] **Step 1: API typecheck**

Run: `pnpm --filter @finsentinel/api typecheck`
Expected: no errors.

- [ ] **Step 2: Full shared + db typecheck**

Run: `pnpm --filter @finsentinel/shared typecheck && pnpm --filter @finsentinel/db typecheck`
Expected: no errors.

- [ ] **Step 3: Targeted test run**

Run:
```bash
pnpm --filter @finsentinel/shared test -- order-draft-schema analysis-schema
pnpm --filter @finsentinel/api test -- analysis-run.service analysis-checkpoint analysis-approval preflight-planner context-fabric analysis-run.controller analysis-run.producer analysis-run.consumer
```
Expected: all green.

- [ ] **Step 4: Boot sanity check**

Run the API locally once to confirm wiring resolves:
```bash
pnpm --filter @finsentinel/api dev
```
Expected: server boots, `POST /analysis/runs` route appears in the Nest router dump, `AnalysisRunConsumer worker started` appears in the log.

Kill with Ctrl-C once verified.

- [ ] **Step 5: Final commit if any cleanup happened**

```bash
git status
# If nothing to commit, move on.
```

---

## Plan A Exit Criteria

- [ ] All 4 new Drizzle tables exist in Postgres and are exported from `@finsentinel/db`.
- [ ] `@finsentinel/shared` exports `orderDraftSchema`, `orderDraftsPayloadSchema`, analysis schemas, and new event/aggregate enum entries.
- [ ] `ANALYSIS_RUN_QUEUE` is registered in `QueueModule` with a producer + consumer.
- [ ] `POST /analysis/runs` enqueues a preflight job; `PAUSE/RESUME/CANCEL` mutate status and append events.
- [ ] `POST /analysis/approvals/:id/resolve` flips PENDING → APPROVED/REJECTED with event emission.
- [ ] `ContextFabricService.assemble` returns a schema-valid `SharedContext`.
- [ ] `PreflightPlannerService.decide` returns upgrade recommendations matching v1 thresholds.
- [ ] `RunOrchestratorService.step` dispatches PREFLIGHT → EXECUTE_STAGE for INTELLIGENCE (further stages no-op until Plan B).
- [ ] API typecheck + targeted tests pass.
- [ ] `ANALYSIS_RUNS_ENABLED` and `CHAT_AUTO_UPGRADE_ENABLED` feature flags are added and default to `false`.

When this is green, move to **Plan B — Agent Teams Orchestrator**.
