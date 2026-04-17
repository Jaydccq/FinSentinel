/**
 * Runtime happy-path integration test (service-level).
 *
 * Exercises the full state machine:
 *   PREFLIGHT → INTELLIGENCE → THESIS → RISK → EXECUTION_PREP
 *     → HUMAN_APPROVAL (WAITING_APPROVAL)
 *     → resolve(APPROVE) → COMPLETED + EXECUTION_PAYLOAD artifact
 *
 * Infrastructure used:
 *   - Real Postgres (Drizzle) — exercises ON CONFLICT, JSONB writes, agentEvents
 *   - All analysis services instantiated directly (no NestJS DI, no HTTP, no BullMQ)
 *   - AnalysisRunProducer stubbed as a synchronous trampoline into orchestrator.step()
 *   - LlmRunner stubbed — returns deterministic JSON per role; EXECUTION_DRAFT_BUILDER
 *     role returns a valid orderDrafts payload to drive the approval gate
 *   - ContextFabricService built with no-op adapters (all return empty strings)
 *   - UnifiedTradingService stubbed (autoDispatch disabled so it's never called)
 *
 * Skip guard: if CI_SKIP_DB_TESTS=1, or if the Postgres connection fails, the
 * suite skips automatically. DATABASE_URL falls back to the known local URL so
 * the test runs without exporting the variable explicitly.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '@finsentinel/db';
import {
  users,
  analysisRuns,
  analysisStages,
  analysisArtifacts,
  analysisApprovals,
  agentEvents,
} from '@finsentinel/db';

import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { AnalysisApprovalService } from '../analysis-approval.service';
import { RunOrchestratorService } from '../run-orchestrator.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from '../teams/role-executor.service';
import { IntelligenceTeamService } from '../teams/intelligence-team.service';
import { ThesisTeamService } from '../teams/thesis-team.service';
import { RiskTeamService } from '../teams/risk-team.service';
import { ExecutionPrepTeamService } from '../teams/execution-prep-team.service';
import { HumanApprovalGateService } from '../teams/human-approval-gate.service';
import { OrderDraftValidator } from '../../trading/order-draft-validator.service';
import { OrderDraftMapper } from '../../trading/order-draft-mapper.service';
import { AgentEventService } from '../../events/agent-event.service';
import type { AnalysisRunJobData } from '../../queue/analysis-run.producer';
import type { AnalysisStageKey } from '@finsentinel/shared';
import { AgentEventType } from '@finsentinel/shared';

// ── Database URL ──────────────────────────────────────────────────────────────

const DB_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:123456@localhost:5432/finsentinel';

// ── Skip guard ─────────────────────────────────────────────────────────────────

const maybeDescribe =
  process.env['CI_SKIP_DB_TESTS'] === '1' ? describe.skip : describe;

// ── Valid order draft fixture ─────────────────────────────────────────────────

const VALID_DRAFT = {
  draftId: '22222222-2222-2222-2222-222222222222',
  portfolioIntent: 'OPEN',
  assetType: 'EQUITY',
  symbol: 'AAPL',
  side: 'BUY',
  quantity: { mode: 'SHARES', value: 10 },
  orderType: 'MARKET',
  limitPrice: null,
  stopPrice: null,
  timeInForce: 'DAY',
  thesisRef: 'thesis-stub',
  riskRef: 'risk-stub',
  maxSlippageBps: 50,
  maxPositionPercent: 5,
  brokerConstraints: { allowFractional: false, extendedHours: false },
  approvalRequired: true as const,
  warnings: [],
} as const;

// ── Standard structured-output JSON (valid against stageStructuredOutputSchema) ──

function makeStructuredOutput(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'stub summary',
    thesis: 'stub thesis',
    risks: [],
    openQuestions: [],
    citations: [],
    confidence: 0.75,
    ...extra,
  });
}

// ── Stub LLM runner ───────────────────────────────────────────────────────────
// Injected into RoleExecutorService via the optional constructor arg.
// Returns deterministic JSON in a fenced code block.
// When the role is EXECUTION_DRAFT_BUILDER, includes a valid orderDrafts array.

function makeLlmStub(): { generate: (args: { system: string; prompt: string; model: unknown; tools: Record<string, unknown> }) => Promise<{ text: string }> } {
  return {
    async generate(args) {
      const isBuilder =
        args.system.toLowerCase().includes('execution') ||
        args.system.toLowerCase().includes('draft') ||
        args.system.toLowerCase().includes('builder');

      const extra: Record<string, unknown> = isBuilder
        ? { orderDrafts: [VALID_DRAFT] }
        : {};

      return {
        text: `\`\`\`json\n${makeStructuredOutput(extra)}\n\`\`\``,
      };
    },
  };
}

// ── Stub ToolRegistry ─────────────────────────────────────────────────────────

function makeToolRegistryStub() {
  return { buildTools: () => ({}) };
}

// ── Stub ContextFabricService ─────────────────────────────────────────────────

function makeContextFabricStub(): ContextFabricService {
  const stub = {
    load: async () => '',
    retrieve: async () => [],
  };
  return new ContextFabricService(
    { load: stub.load },
    { load: stub.load },
    { load: async () => ({ summary: '', count: 0 }) },
    { retrieve: stub.retrieve },
  );
}

// ── Stub UnifiedTradingService ─────────────────────────────────────────────────
// Only used if APPROVAL_AUTO_DISPATCH_ENABLED — we pass enabled:false so this
// stub is never actually called, but the type must be satisfied.

function makeUnifiedTradingStub() {
  return {
    stage: async () => {},
    commit: async () => {},
    execute: async () => {},
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

maybeDescribe('runtime happy-path (service-level integration)', () => {
  let pgClient: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  // Shared services (one instance per suite)
  let eventsSvc: AgentEventService;
  let runsSvc: AnalysisRunService;
  let checkpointsSvc: AnalysisCheckpointService;
  let approvalsSvc: AnalysisApprovalService;
  let orchestrator: RunOrchestratorService;

  // Per-test data
  let testUserId: string;
  let runId: string;

  beforeAll(async () => {
    pgClient = postgres(DB_URL, { max: 5 });
    db = drizzle(pgClient, { schema });

    // ── Build all services ─────────────────────────────────────────────

    eventsSvc = new AgentEventService(db as never);
    runsSvc = new AnalysisRunService(db as never, eventsSvc);
    checkpointsSvc = new AnalysisCheckpointService(db as never, eventsSvc);

    const validator = new OrderDraftValidator();
    const mapper = new OrderDraftMapper();

    // Approval service — autoDispatch disabled
    approvalsSvc = new AnalysisApprovalService(
      db as never,
      eventsSvc,
      runsSvc,
      checkpointsSvc,
      mapper,
      makeUnifiedTradingStub() as never,
      { enabled: false },
    );

    // ── Build stub producer with trampoline ──────────────────────────────
    // The orchestrator calls producer.enqueueXxx(...) to chain jobs. Instead
    // of hitting Redis we immediately call orchestrator.step() synchronously.
    // We use a wrapper object so we can set the orchestrator reference after
    // construction (break the circular dependency).
    const producerRef: { orchestrator?: RunOrchestratorService } = {};
    const stubProducer = {
      async enqueuePreflight(args: { runId: string; userId: string }) {
        await producerRef.orchestrator!.step({
          ...args,
          stepKind: 'PREFLIGHT' as const,
        });
      },
      async enqueueExecuteStage(args: {
        runId: string;
        userId: string;
        stageKey: AnalysisStageKey;
      }) {
        const jobData: AnalysisRunJobData = {
          ...args,
          stepKind: 'EXECUTE_STAGE' as const,
        };
        await producerRef.orchestrator!.step(jobData);
      },
      async enqueueResume(args: { runId: string; userId: string }) {
        await producerRef.orchestrator!.step({
          ...args,
          stepKind: 'RESUME' as const,
        });
      },
    };

    // ── Build orchestrator ────────────────────────────────────────────────
    orchestrator = new RunOrchestratorService(
      runsSvc,
      checkpointsSvc,
      stubProducer as never,
    );
    // Wire the back-reference so the trampoline can call step()
    producerRef.orchestrator = orchestrator;

    // ── Build team services ───────────────────────────────────────────────
    const llmStub = makeLlmStub();
    const toolRegistry = makeToolRegistryStub();
    const roleExecutor = new RoleExecutorService(
      toolRegistry as never,
      llmStub,
    );
    const fabric = makeContextFabricStub();

    const intelligenceTeam = new IntelligenceTeamService(
      roleExecutor,
      runsSvc,
      checkpointsSvc,
      fabric,
      eventsSvc,
    );
    const thesisTeam = new ThesisTeamService(
      roleExecutor,
      runsSvc,
      checkpointsSvc,
      fabric,
      eventsSvc,
    );
    const riskTeam = new RiskTeamService(
      roleExecutor,
      runsSvc,
      checkpointsSvc,
      fabric,
      eventsSvc,
    );
    const executionPrepTeam = new ExecutionPrepTeamService(
      roleExecutor,
      runsSvc,
      checkpointsSvc,
      validator,
      approvalsSvc,
      fabric,
      eventsSvc,
    );
    const humanApprovalGate = new HumanApprovalGateService(
      runsSvc,
      checkpointsSvc,
      eventsSvc,
    );

    // ── Register stage executors (same as TeamRegistry.onModuleInit) ──────
    const teams = [
      intelligenceTeam,
      thesisTeam,
      riskTeam,
      executionPrepTeam,
      humanApprovalGate,
    ];
    for (const team of teams) {
      orchestrator.registerStageExecutor(team.stageKey, (args) =>
        team.execute(args),
      );
    }

    // ── Seed a test user ──────────────────────────────────────────────────
    testUserId = randomUUID();
    await db.insert(users).values({
      id: testUserId,
      username: `ts-happy-${testUserId.slice(0, 8)}`,
      email: `test-happy-path-${testUserId}@finsentinel.test`,
      password: 'test-placeholder-not-used',
      displayName: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, 60_000);

  afterAll(async () => {
    // Clean up test user (cascades to analysis_runs → stages/artifacts/approvals,
    // and to agent_events via userId FK).
    await db.delete(users).where(eq(users.id, testUserId));
    await pgClient.end();
  }, 30_000);

  beforeEach(async () => {
    runId = randomUUID();
    // Insert parent analysis_run row with all non-nullable columns explicit
    // (avoids the Drizzle+postgres.js mixed-default bind bug).
    await db.insert(analysisRuns).values({
      id: runId,
      userId: testUserId,
      sourceMode: 'WORKSPACE',
      status: 'QUEUED',
      inputSnapshotJson: { prompt: 'analyze AAPL for a swing trade', ticker: 'AAPL' },
      currentStageKey: null,
      complexityScore: null,
      upgradeReason: null,
      parentChatSessionId: null,
      sharedContextJson: null,
      decisionObjectJson: null,
      finalReportMarkdown: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      archivedAt: null,
    });
  });

  afterEach(async () => {
    // Clean up per-run rows in reverse FK order
    await db.delete(analysisApprovals).where(eq(analysisApprovals.runId, runId));
    await db.delete(analysisArtifacts).where(eq(analysisArtifacts.runId, runId));
    await db.delete(analysisStages).where(eq(analysisStages.runId, runId));
    await db.delete(agentEvents).where(
      and(
        eq(agentEvents.userId, testUserId),
        eq(agentEvents.aggregateType, 'ANALYSIS_RUN'),
      ),
    );
    await db.delete(analysisRuns).where(eq(analysisRuns.id, runId));
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Main happy-path
  // ════════════════════════════════════════════════════════════════════════════

  it(
    'PREFLIGHT → all stages COMPLETED → WAITING_APPROVAL → APPROVE → COMPLETED + EXECUTION_PAYLOAD',
    async () => {
      // ── Step 1: Drive the state machine ──────────────────────────────────
      // The trampoline producer synchronously fans the pipeline through
      // INTELLIGENCE → THESIS → RISK → EXECUTION_PREP → HUMAN_APPROVAL.
      // The run lands at WAITING_APPROVAL after this call returns.
      await orchestrator.step({
        runId,
        userId: testUserId,
        stepKind: 'PREFLIGHT',
      });

      // ── Step 2: Verify run is WAITING_APPROVAL ────────────────────────────
      const runAfterPipeline = await runsSvc.getForUser(testUserId, runId);
      expect(runAfterPipeline?.status).toBe('WAITING_APPROVAL');

      // ── Step 3: All four team stages should be COMPLETED ─────────────────
      const stages = await runsSvc.listStagesForRun(runId);
      const stageMap = Object.fromEntries(
        stages.map((s) => [s.stageKey, s.status]),
      );
      // INTELLIGENCE, THESIS, RISK, EXECUTION_PREP — each must be COMPLETED
      expect(stageMap['INTELLIGENCE']).toBe('COMPLETED');
      expect(stageMap['THESIS']).toBe('COMPLETED');
      expect(stageMap['RISK']).toBe('COMPLETED');
      expect(stageMap['EXECUTION_PREP']).toBe('COMPLETED');

      // ── Step 4: An EXECUTION_APPROVAL_REQUIRED approval should be PENDING ─
      const approvals = await runsSvc.listApprovalsForRun(runId);
      expect(approvals).toHaveLength(1);
      const approval = approvals[0];
      expect(approval?.status).toBe('PENDING');
      const approvalId = approval?.id as string;
      expect(approvalId).toBeTruthy();

      // ── Step 5: ORDER_DRAFTS artifact should exist ────────────────────────
      const artifacts = await runsSvc.listArtifactsForRun(runId);
      const orderDraftsArtifact = artifacts.find(
        (a) => a.artifactKind === 'ORDER_DRAFTS',
      );
      expect(orderDraftsArtifact).toBeDefined();

      // ── Step 6: Resolve the approval ──────────────────────────────────────
      await approvalsSvc.resolve({
        userId: testUserId,
        approvalId,
        decision: 'APPROVE',
      });

      // ── Step 7: Run should now be COMPLETED ───────────────────────────────
      const runAfterApproval = await runsSvc.getForUser(testUserId, runId);
      expect(runAfterApproval?.status).toBe('COMPLETED');

      // ── Step 8: EXECUTION_PAYLOAD artifact should exist ───────────────────
      const artifactsAfter = await runsSvc.listArtifactsForRun(runId);
      const execPayload = artifactsAfter.find(
        (a) => a.artifactKind === 'EXECUTION_PAYLOAD',
      );
      expect(execPayload).toBeDefined();

      // ── Step 9: Lifecycle events in agent_events ──────────────────────────
      const events = await db
        .select()
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.userId, testUserId),
            eq(agentEvents.aggregateType, 'ANALYSIS_RUN'),
          ),
        );

      const eventTypes = new Set(events.map((e) => e.eventType));

      const expectedLifecycle: AgentEventType[] = [
        AgentEventType.RUN_STARTED,
        AgentEventType.INTELLIGENCE_TEAM_COMPLETED,
        AgentEventType.THESIS_TEAM_COMPLETED,
        AgentEventType.RISK_TEAM_COMPLETED,
        AgentEventType.EXECUTION_PREP_TEAM_COMPLETED,
        AgentEventType.EXECUTION_APPROVAL_REQUIRED,
        AgentEventType.RUN_COMPLETED,
      ];

      for (const expected of expectedLifecycle) {
        expect(eventTypes, `expected event ${expected}`).toContain(expected);
      }

      // EXECUTION_APPROVED lives on the ANALYSIS_APPROVAL aggregate
      const approvalEvents = await db
        .select()
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.userId, testUserId),
            eq(agentEvents.aggregateType, 'ANALYSIS_APPROVAL'),
          ),
        );
      const approvalEventTypes = new Set(approvalEvents.map((e) => e.eventType));
      expect(approvalEventTypes).toContain(AgentEventType.EXECUTION_APPROVED);
    },
    120_000,
  );

  // ════════════════════════════════════════════════════════════════════════════
  // Rejection path
  // ════════════════════════════════════════════════════════════════════════════

  it(
    'APPROVE=REJECT transitions run to CANCELED',
    async () => {
      // Drive to WAITING_APPROVAL
      await orchestrator.step({
        runId,
        userId: testUserId,
        stepKind: 'PREFLIGHT',
      });

      const approvals = await runsSvc.listApprovalsForRun(runId);
      const approvalId = approvals[0]?.id as string;

      await approvalsSvc.resolve({
        userId: testUserId,
        approvalId,
        decision: 'REJECT',
        note: 'Not now',
      });

      const run = await runsSvc.getForUser(testUserId, runId);
      expect(run?.status).toBe('CANCELED');

      // EXECUTION_PAYLOAD must NOT exist
      const artifacts = await runsSvc.listArtifactsForRun(runId);
      const execPayload = artifacts.find((a) => a.artifactKind === 'EXECUTION_PAYLOAD');
      expect(execPayload).toBeUndefined();
    },
    120_000,
  );

  // ════════════════════════════════════════════════════════════════════════════
  // Checkpoint idempotency under the real pipeline
  // ════════════════════════════════════════════════════════════════════════════

  it(
    're-running PREFLIGHT step twice results in exactly one row per stage (idempotent startStage)',
    async () => {
      // Run the pipeline once
      await orchestrator.step({ runId, userId: testUserId, stepKind: 'PREFLIGHT' });

      // The run is now WAITING_APPROVAL — reset it to QUEUED so we can re-trigger
      await db
        .update(analysisRuns)
        .set({ status: 'QUEUED', currentStageKey: null, updatedAt: new Date() })
        .where(eq(analysisRuns.id, runId));

      // Re-run — ON CONFLICT DO UPDATE in startStage should prevent duplicate stage rows
      await orchestrator.step({ runId, userId: testUserId, stepKind: 'PREFLIGHT' });

      const stages = await runsSvc.listStagesForRun(runId);
      // Each stageKey should appear at most once (upsert, not insert-duplicate)
      const stageKeySet = new Set(stages.map((s) => s.stageKey));
      expect(stageKeySet.size).toBe(stages.length);
      // All four team stages present
      for (const key of ['INTELLIGENCE', 'THESIS', 'RISK', 'EXECUTION_PREP']) {
        expect(stageKeySet).toContain(key);
      }
    },
    120_000,
  );
});
