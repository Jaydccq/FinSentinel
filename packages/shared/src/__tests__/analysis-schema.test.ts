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
