import { Injectable } from '@nestjs/common';
import {
  decisionObjectSchema,
  orderDraftsPayloadSchema,
  type AnalysisStageKey,
  type DecisionObject,
  type SharedContext,
} from '@finsentinel/shared';

interface RunReportStage {
  stageKey: AnalysisStageKey;
  humanReportMarkdown: string | null;
  structuredOutput: Record<string, unknown> | null;
}

interface RunReportBuildArgs {
  sharedContext: SharedContext | null;
  stages: RunReportStage[];
  executionPayload: Record<string, unknown> | null;
}

@Injectable()
export class RunReportAssembler {
  build(args: RunReportBuildArgs): {
    finalReportMarkdown: string;
    decisionObject: DecisionObject | null;
  } {
    const sections = args.stages
      .filter((stage) => stage.humanReportMarkdown != null && stage.humanReportMarkdown.trim() !== '')
      .map((stage) => `## ${stage.stageKey}\n\n${stage.humanReportMarkdown}`);

    const contextSection = args.sharedContext
      ? [
          '## Context Snapshot',
          '',
          `- Long term: ${args.sharedContext.longTermPreferenceContext.summary}`,
          `- Mid term: ${args.sharedContext.midTermStrategyContext.summary}`,
          `- Session: ${args.sharedContext.shortTermSessionContext.summary}`,
          `- Retrieval: ${args.sharedContext.retrievalContext.summary}`,
        ].join('\n')
      : '';

    const finalReportMarkdown = [
      '# Final Analysis Report',
      contextSection,
      ...sections,
    ]
      .filter((section) => section.trim() !== '')
      .join('\n\n');

    return {
      finalReportMarkdown,
      decisionObject: this.buildDecisionObject(args),
    };
  }

  private buildDecisionObject(args: RunReportBuildArgs): DecisionObject | null {
    const riskStage = args.stages.find((stage) => stage.stageKey === 'RISK');
    const risk = riskStage?.structuredOutput ?? {};
    const executionPayload = orderDraftsPayloadSchema
      .catch({ orderDrafts: [] })
      .parse(args.executionPayload ?? { orderDrafts: [] });

    const candidate = {
      portfolioDecision: risk['portfolioDecision'],
      allocationGuidance: risk['allocationGuidance'],
      riskLimits: risk['riskLimits'],
      alertTriggers: risk['alertTriggers'],
      confidence: risk['confidence'],
      evidenceRefs: Array.isArray(risk['evidenceRefs']) ? risk['evidenceRefs'] : [],
      executionPayload,
      alertPayload:
        typeof risk['alertPayload'] === 'object' && risk['alertPayload'] !== null
          ? risk['alertPayload']
          : { alerts: [] },
      strategyArchivePayload:
        typeof risk['strategyArchivePayload'] === 'object' && risk['strategyArchivePayload'] !== null
          ? risk['strategyArchivePayload']
          : { snapshot: {} },
    };

    const parsed = decisionObjectSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
}
