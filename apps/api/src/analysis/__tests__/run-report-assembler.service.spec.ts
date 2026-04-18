import { describe, expect, it } from 'vitest';

import { RunReportAssembler } from '../run-report-assembler.service';

const sharedContext = {
  longTermPreferenceContext: { summary: 'risk aware', sourceIds: [], updatedAt: '2026-04-18T00:00:00.000Z' },
  midTermStrategyContext: { summary: 'swing trading', sourceIds: [], updatedAt: '2026-04-18T00:00:00.000Z' },
  shortTermSessionContext: { summary: 'chat summary', sourceIds: [], updatedAt: '2026-04-18T00:00:00.000Z' },
  retrievalContext: { summary: 'earnings beat', sourceIds: ['news-1'], updatedAt: '2026-04-18T00:00:00.000Z' },
};

describe('RunReportAssembler', () => {
  it('builds finalReportMarkdown and decisionObject from stage outputs', () => {
    const assembler = new RunReportAssembler();
    const result = assembler.build({
      sharedContext,
      stages: [
        {
          stageKey: 'RISK',
          humanReportMarkdown: 'risk ok',
          structuredOutput: {
            portfolioDecision: 'BUY',
            allocationGuidance: { notes: 'scale in', targets: [] },
            riskLimits: { maxDrawdownPct: 8, stopLossTriggers: [] },
            alertTriggers: [],
            summary: 'risk ok',
            thesis: 'buy',
            risks: [],
            openQuestions: [],
            citations: [],
            confidence: 0.72,
          },
        },
        {
          stageKey: 'EXECUTION_PREP',
          humanReportMarkdown: 'drafts ready',
          structuredOutput: { orderDraftCount: 0, orderDraftsArtifactId: 'artifact-order-drafts' },
        },
      ],
      executionPayload: { orderDrafts: [] },
    });

    expect(result.finalReportMarkdown).toContain('risk ok');
    expect(result.finalReportMarkdown).toContain('drafts ready');
    expect(result.decisionObject?.portfolioDecision).toBe('BUY');
    expect(result.decisionObject?.executionPayload.orderDrafts).toEqual([]);
  });

  it('returns null decisionObject when stage output cannot satisfy the contract', () => {
    const assembler = new RunReportAssembler();
    const result = assembler.build({
      sharedContext,
      stages: [
        {
          stageKey: 'RISK',
          humanReportMarkdown: 'risk output missing required fields',
          structuredOutput: { portfolioDecision: 'BUY', confidence: 0.7 },
        },
      ],
      executionPayload: { orderDrafts: [] },
    });

    expect(result.finalReportMarkdown).toContain('risk output missing required fields');
    expect(result.decisionObject).toBeNull();
  });
});
