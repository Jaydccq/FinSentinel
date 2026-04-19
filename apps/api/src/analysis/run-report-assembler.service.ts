import { Injectable } from '@nestjs/common';
import {
  decisionObjectSchema,
  orderDraftsPayloadSchema,
  strategyArchivePayloadSchema,
} from '@finsentinel/shared';
import type {
  AnalysisStageKey,
  DecisionObject,
  SharedContext,
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

function parseStrategyArchivePayload(value: unknown) {
  const parsed = strategyArchivePayloadSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  if (isLegacyStrategyArchivePayload(value)) {
    return value;
  }

  return { snapshot: {} };
}

function isLegacyStrategyArchivePayload(
  value: unknown,
): value is { snapshot: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const snapshot = (value as { snapshot?: unknown }).snapshot;
  return typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot);
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
      strategyArchivePayload: parseStrategyArchivePayload(risk['strategyArchivePayload']),
    };

    const parsed = decisionObjectSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
}
