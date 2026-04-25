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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
import { ContextJournalService } from '../context-journal.service';
import { RunReportAssembler } from '../run-report-assembler.service';
import { RunOrchestratorService } from '../run-orchestrator.service';
import { StageGraphService } from '../stage-graph.service';
import { TeamPresetService } from '../team-preset.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from '../teams/role-executor.service';
import { IntelligenceTeamService } from '../teams/intelligence-team.service';
import { StrategyEvidenceService } from '../strategy-evidence.service';
import { ThesisTeamService } from '../teams/thesis-team.service';
import { RiskTeamService } from '../teams/risk-team.service';
import { ExecutionPrepTeamService } from '../teams/execution-prep-team.service';
import { HumanApprovalGateService } from '../teams/human-approval-gate.service';
import { OrderDraftValidator } from '../../trading/order-draft-validator.service';
import { OrderDraftMapper } from '../../trading/order-draft-mapper.service';
import { AgentEventService } from '../../events/agent-event.service';
import type { AnalysisRunJobData } from '../../queue/analysis-run.producer';
import type { AnalysisStageKey, CreateRunRequest } from '@finsentinel/shared';
import { AgentEventType } from '@finsentinel/shared';
import type { StrategyArchivePayload } from '@finsentinel/shared';
import type { LlmRunner } from '../teams/role-executor.service';

// ── Database URL ──────────────────────────────────────────────────────────────

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:123456@localhost:5432/finsentinel';

// ── Skip guard ─────────────────────────────────────────────────────────────────
// Skip when Postgres is definitely unavailable:
//   - explicit opt-out: CI_SKIP_DB_TESTS=1
//   - CI without DATABASE_URL: auto-skip so GitHub Actions doesn't fail on the
//     hardcoded fallback URL. When CI adds a Postgres service container and
//     exports DATABASE_URL, these tests will run automatically.

const skipDbTests =
  process.env['CI_SKIP_DB_TESTS'] === '1' ||
  (process.env['CI'] === 'true' && !process.env['DATABASE_URL']);
const maybeDescribe = skipDbTests ? describe.skip : describe;

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

const VALID_STRATEGY_ARCHIVE = {
  status: 'EVALUATED',
  ticker: 'AAPL',
  generatedAt: '2026-04-19T00:00:00.000Z',
  bars: {
    requestedDays: 260,
    receivedBars: 260,
    source: 'market-data.service',
  },
  evaluations: [
    {
      templateKey: 'SMA_50_200_RSI_LONG_ONLY',
      signal: 'ENTER_LONG',
      confidence: 0.81,
      recommendedNextStep: 'PAPER_ONLY',
      reasons: ['Price is above the long-term trend and momentum is constructive.'],
      warnings: ['Entry remains advisory until execution checks pass.'],
      requiredBars: 200,
      receivedBars: 260,
      indicatorSnapshot: {
        close: 192.15,
        rsi14: 63.2,
        stochasticK14: 71.4,
        stochasticD3: 69.8,
        ema200: 184.3,
        sma50: 189.7,
        sma200: 181.9,
      },
      costProfile: {
        makerFeeBps: 1.5,
        takerFeeBps: 4.5,
        estimatedRoundTripBps: 6,
        expectedAnnualTrades: 12,
        feeDragWarning: false,
      },
    },
  ],
  selectedTemplateKey: 'SMA_50_200_RSI_LONG_ONLY',
  summary: {
    enterLongCount: 1,
    blockedCount: 0,
    warnings: ['Entry remains advisory until execution checks pass.'],
    recommendedNextStep: 'PAPER_ONLY',
  },
} as const satisfies StrategyArchivePayload;

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
// Dispatches on `roleKey` (threaded from RoleExecutorService.run) — never on
// prompt text — so a prompt rename cannot cause silent mis-detection.
// Throws if roleKey is absent or unrecognised so the test fails loudly instead
// of silently returning the wrong payload.

function makeLlmStub(): LlmRunner {
  return {
    async generate(args) {
      const roleKey = args.roleKey;
      if (!roleKey) {
        throw new Error(
          'LLM stub: roleKey was not threaded through — update RoleExecutorService.run() to pass roleKey to llm.generate()',
        );
      }

      let extra: Record<string, unknown>;
      switch (roleKey) {
        case 'EXECUTION_DRAFT_BUILDER':
          extra = { orderDrafts: [VALID_DRAFT] };
          break;
        case 'MARKET_ANALYST':
        case 'NEWS_ANALYST':
        case 'FUNDAMENTALS_ANALYST':
        case 'SENTIMENT_ANALYST':
        case 'POSITIVE_CASE':
        case 'NEGATIVE_CASE':
        case 'THESIS_LEAD':
        case 'RISK_REVIEWER':
        case 'PORTFOLIO_MANAGER':
        case 'TRADE_PLANNER':
          extra = {};
          break;
        default: {
          // TypeScript exhaustiveness guard — also a runtime safety net
          const _exhaustive: never = roleKey;
          throw new Error(`LLM stub: unrecognised roleKey '${String(_exhaustive)}'`);
        }
      }

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
    const contextJournal = new ContextJournalService(db as never);
    const reportAssembler = new RunReportAssembler();

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
      contextJournal,
      reportAssembler,
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
    const stageGraph = new StageGraphService(new TeamPresetService());
    orchestrator = new RunOrchestratorService(
      runsSvc,
      checkpointsSvc,
      stubProducer as never,
      stageGraph,
    );
    // Wire the back-reference so the trampoline can call step()
    producerRef.orchestrator = orchestrator;

    // ── Build team services ───────────────────────────────────────────────
    const llmStub = makeLlmStub();
    const toolRegistry = makeToolRegistryStub();
    const roleExecutor = new RoleExecutorService(toolRegistry as never, llmStub);
    const fabric = makeContextFabricStub();
    const strategyEvidence = {
      buildArchive: vi.fn().mockImplementation(async ({ ticker }) => {
        if (ticker === 'AAPL') {
          return VALID_STRATEGY_ARCHIVE;
        }

        return {
          status: 'SKIPPED',
          generatedAt: '2026-04-19T00:00:00.000Z',
          bars: {
            requestedDays: 260,
            receivedBars: 0,
            source: 'market-data.service',
          },
          evaluations: [],
          selectedTemplateKey: null,
          summary: {
            enterLongCount: 0,
            blockedCount: 0,
            warnings: ['No ticker in run input.'],
            recommendedNextStep: null,
          },
          skipReason: 'No ticker in run input.',
        } as const satisfies StrategyArchivePayload;
      }),
    } as unknown as StrategyEvidenceService;

    const intelligenceTeam = new IntelligenceTeamService(
      roleExecutor,
      runsSvc,
      strategyEvidence,
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
    const riskTeam = new RiskTeamService(roleExecutor, runsSvc, checkpointsSvc, fabric, eventsSvc);
    const executionPrepTeam = new ExecutionPrepTeamService(
      roleExecutor,
      runsSvc,
      checkpointsSvc,
      validator,
      approvalsSvc,
      fabric,
      eventsSvc,
    );
    const humanApprovalGate = new HumanApprovalGateService(runsSvc, checkpointsSvc, eventsSvc);

    // ── Register stage executors (same as TeamRegistry.onModuleInit) ──────
    const teams = [intelligenceTeam, thesisTeam, riskTeam, executionPrepTeam, humanApprovalGate];
    for (const team of teams) {
      orchestrator.registerStageExecutor(team.stageKey, (args) => team.execute(args));
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
    // Use createQueued() so RUN_QUEUED is emitted into agent_events — mirrors
    // the real production path and satisfies the plan-spec requirement.
    // Use EXECUTION_READY so all five stages (including EXECUTION_PREP and
    // HUMAN_APPROVAL) are enabled in the stage graph.
    const req: CreateRunRequest = {
      prompt: 'analyze AAPL for a swing trade',
      sourceMode: 'WORKSPACE',
      ticker: 'AAPL',
      preset: 'EXECUTION_READY',
    };
    const created = await runsSvc.createQueued(testUserId, req);
    runId = created.id;
  });

  afterEach(async () => {
    // Clean up per-run rows in reverse FK order
    await db.delete(analysisApprovals).where(eq(analysisApprovals.runId, runId));
    await db.delete(analysisArtifacts).where(eq(analysisArtifacts.runId, runId));
    await db.delete(analysisStages).where(eq(analysisStages.runId, runId));
    await db
      .delete(agentEvents)
      .where(
        and(eq(agentEvents.userId, testUserId), eq(agentEvents.aggregateType, 'ANALYSIS_RUN')),
      );
    await db.delete(analysisRuns).where(eq(analysisRuns.id, runId));
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Main happy-path
  // ════════════════════════════════════════════════════════════════════════════

  it('PREFLIGHT → all stages COMPLETED → WAITING_APPROVAL → APPROVE → COMPLETED + EXECUTION_PAYLOAD', async () => {
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
    const stageMap = Object.fromEntries(stages.map((s) => [s.stageKey, s.status]));
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

    // ── Step 5: STRATEGY_ARCHIVE artifact should exist ────────────────────
    const artifacts = await runsSvc.listArtifactsForRun(runId);
    const strategyArchiveArtifact = artifacts.find((a) => a.artifactKind === 'STRATEGY_ARCHIVE');
    expect(strategyArchiveArtifact).toBeDefined();
    expect(strategyArchiveArtifact?.payloadJson).toEqual(VALID_STRATEGY_ARCHIVE);

    // ── Step 6: ORDER_DRAFTS artifact should still come from EXECUTION_PREP ─
    const orderDraftsArtifact = artifacts.find((a) => a.artifactKind === 'ORDER_DRAFTS');
    expect(orderDraftsArtifact).toBeDefined();
    expect(orderDraftsArtifact?.payloadJson).toEqual({
      orderDrafts: [VALID_DRAFT],
    });

    // ── Step 7: Resolve the approval ──────────────────────────────────────
    await approvalsSvc.resolve({
      userId: testUserId,
      approvalId,
      decision: 'APPROVE',
    });

    // ── Step 8: Run should now be COMPLETED ───────────────────────────────
    const runAfterApproval = await runsSvc.getForUser(testUserId, runId);
    expect(runAfterApproval?.status).toBe('COMPLETED');

    const completedRun = await db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.id, runId))
      .limit(1);
    expect(completedRun[0]?.decisionObjectJson).toMatchObject({
      strategyArchivePayload: VALID_STRATEGY_ARCHIVE,
      executionPayload: {
        orderDrafts: [VALID_DRAFT],
      },
    });

    // ── Step 9: EXECUTION_PAYLOAD artifact should exist ───────────────────
    const artifactsAfter = await runsSvc.listArtifactsForRun(runId);
    const execPayload = artifactsAfter.find((a) => a.artifactKind === 'EXECUTION_PAYLOAD');
    expect(execPayload).toBeDefined();
    expect(execPayload?.payloadJson).toMatchObject({
      orderDrafts: [VALID_DRAFT],
      stageRequests: [{ action: 'BUY', symbol: 'AAPL', qty: '10' }],
    });

    // ── Step 10: Lifecycle events in agent_events ─────────────────────────
    const events = await db
      .select()
      .from(agentEvents)
      .where(
        and(eq(agentEvents.userId, testUserId), eq(agentEvents.aggregateType, 'ANALYSIS_RUN')),
      );

    const eventTypes = new Set(events.map((e) => e.eventType));

    const expectedLifecycle: AgentEventType[] = [
      AgentEventType.RUN_QUEUED,
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
        and(eq(agentEvents.userId, testUserId), eq(agentEvents.aggregateType, 'ANALYSIS_APPROVAL')),
      );
    const approvalEventTypes = new Set(approvalEvents.map((e) => e.eventType));
    expect(approvalEventTypes).toContain(AgentEventType.EXECUTION_APPROVED);
  }, 120_000);

  // ════════════════════════════════════════════════════════════════════════════
  // Rejection path
  // ════════════════════════════════════════════════════════════════════════════

  it('APPROVE=REJECT transitions run to CANCELED', async () => {
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
  }, 120_000);

  // ════════════════════════════════════════════════════════════════════════════
  // Checkpoint idempotency under the real pipeline
  // ════════════════════════════════════════════════════════════════════════════

  it('re-running PREFLIGHT step twice results in exactly one row per stage (idempotent startStage)', async () => {
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
  }, 120_000);
});
