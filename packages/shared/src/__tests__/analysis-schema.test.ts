import { describe, it, expect } from 'vitest';
import {
  analysisRunSourceModeSchema,
  analysisRunStatusSchema,
  analysisStageKeySchema,
  decisionObjectSchema,
  stageStatusSchema,
  stageStructuredOutputSchema,
  sharedContextSchema,
  complexityEstimateSchema,
  createRunRequestSchema,
  analysisPresetSchema,
  roleSummarySchema,
} from '../schemas/analysis';
import { AgentEventType } from '../enums/agent-event-type';

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
      strategyArchivePayload: {
        status: 'EVALUATED',
        ticker: 'AAPL',
        generatedAt: '2026-04-19T12:00:00.000Z',
        bars: {
          requestedDays: 260,
          receivedBars: 260,
          source: 'polygon.daily',
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: [],
          recommendedNextStep: null,
        },
      },
    };
    expect(decisionObjectSchema.parse(d)).toMatchObject(d);
  });

  it('decisionObject keeps the legacy snapshot fallback during rollout', () => {
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

  it('accepts a run request with preset, enabledTeams and researchDepth', () => {
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

  it('defaults preset to STANDARD_ANALYSIS when omitted', () => {
    const parsed = createRunRequestSchema.parse({
      prompt: 'hello',
      sourceMode: 'WORKSPACE',
    });
    expect(parsed.preset).toBe('STANDARD_ANALYSIS');
  });

  it('accepts a role summary payload', () => {
    const parsed = roleSummarySchema.parse({
      roleKey: 'THESIS_LEAD',
      status: 'COMPLETED',
      durationMs: 8200,
      toolCallCount: 2,
      summary: 'Merged positive and negative case.',
    });
    expect(parsed.durationMs).toBe(8200);
  });

  it('exports new generic runtime events', () => {
    expect(AgentEventType.ROLE_STARTED).toBe('ROLE_STARTED');
    expect(AgentEventType.STAGE_SKIPPED).toBe('STAGE_SKIPPED');
  });

  it('still exports role-specific events for backward compatibility', () => {
    expect(AgentEventType.POSITIVE_CASE_STARTED).toBe('POSITIVE_CASE_STARTED');
  });
});

describe('analysisPresetSchema', () => {
  it('parses all four presets', () => {
    for (const value of ['FAST_RISK_CHECK', 'STANDARD_ANALYSIS', 'DEEP_THESIS', 'EXECUTION_READY']) {
      expect(analysisPresetSchema.parse(value)).toBe(value);
    }
  });
});
