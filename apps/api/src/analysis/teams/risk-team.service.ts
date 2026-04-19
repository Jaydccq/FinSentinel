import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  strategyArchivePayloadSchema,
} from '@finsentinel/shared';
import type {
  AnalysisStageKey,
  StageStructuredOutput,
  StrategyArchivePayload,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from './role-executor.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import {
  RISK_REVIEWER_PROMPT,
  PORTFOLIO_MANAGER_PROMPT,
} from '../contracts/prompts';

function parseStrategyArchivePayload(value: unknown): StrategyArchivePayload | undefined {
  const parsed = strategyArchivePayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

@Injectable()
export class RiskTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'RISK';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.emit(args, AgentEventType.RISK_TEAM_STARTED, {});

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string };

    const priorStageOutputs: Record<string, StageStructuredOutput> = {};
    for (const stageKey of ['INTELLIGENCE', 'THESIS'] as const) {
      const s = await this.checkpoints.findByStage(args.runId, stageKey);
      if (s?.structuredOutputJson) {
        priorStageOutputs[stageKey] = s.structuredOutputJson as StageStructuredOutput;
      }
    }

    const intelligenceArchive = parseStrategyArchivePayload(
      (priorStageOutputs.INTELLIGENCE as Record<string, unknown> | undefined)
        ?.strategyArchivePayload,
    );

    const ctx = await this.fabric.assemble({
      userId: args.userId,
      runId: args.runId,
      prompt: input.prompt,
    });
    const contextText = this.fabric.toPromptReady(ctx);
    const commonInput = {
      prompt: input.prompt,
      contextText,
      priorStageOutputs,
      extra: {
        strategyArchivePayload: intelligenceArchive,
      },
    };

    const reviewer = await this.roleExecutor.run({
      roleKey: 'RISK_REVIEWER',
      systemPrompt: RISK_REVIEWER_PROMPT,
      userInput: commonInput,
      userId: args.userId,
    });
    const pm = await this.roleExecutor.run({
      roleKey: 'PORTFOLIO_MANAGER',
      systemPrompt: PORTFOLIO_MANAGER_PROMPT,
      userInput: {
        ...commonInput,
        extra: {
          strategyArchivePayload: intelligenceArchive,
          riskReviewerOutput: reviewer.structured,
        },
      },
      userId: args.userId,
    });

    const pmExt = pm.structured as unknown as Record<string, unknown>;
    const pmArchive = parseStrategyArchivePayload(pmExt.strategyArchivePayload);

    const teamOutput: StageStructuredOutput = {
      summary: pm.structured.summary,
      thesis: pm.structured.thesis,
      risks: [...reviewer.structured.risks, ...pm.structured.risks],
      openQuestions: pm.structured.openQuestions,
      citations: pm.structured.citations,
      confidence: pm.structured.confidence,
      strategyArchivePayload: pmArchive ?? intelligenceArchive ?? { snapshot: {} },
      portfolioDecision: (pmExt.portfolioDecision as string | undefined) ?? 'HOLD',
      allocationGuidance:
        (pmExt.allocationGuidance as unknown) ?? { notes: '', targets: [] },
      riskLimits:
        (pmExt.riskLimits as unknown) ?? {
          maxDrawdownPct: 10,
          stopLossTriggers: [],
        },
      alertTriggers: (pmExt.alertTriggers as unknown) ?? [],
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: [
        '# Risk Team Report',
        '## Risk Reviewer',
        reviewer.rawMarkdown,
        '## Portfolio Manager',
        pm.rawMarkdown,
      ].join('\n\n'),
    });

    await this.emit(args, AgentEventType.RISK_TEAM_COMPLETED, {});
  }

  private async emit(
    args: TeamExecutionArgs,
    eventType: AgentEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      eventType,
      payload,
      null,
    );
  }
}
