import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type RoleSummary,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { ContextFabricService } from '../context-fabric.service';
import { StrategyEvidenceService } from '../strategy-evidence.service';
import { RoleExecutorService } from './role-executor.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import type { RoleKey } from '../contracts/role-contract';
import {
  MARKET_ANALYST_PROMPT,
  NEWS_ANALYST_PROMPT,
  FUNDAMENTALS_ANALYST_PROMPT,
  SENTIMENT_ANALYST_PROMPT,
} from '../contracts/prompts';

@Injectable()
export class IntelligenceTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'INTELLIGENCE';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly strategyEvidence: StrategyEvidenceService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      AgentEventType.INTELLIGENCE_TEAM_STARTED,
      {},
      null,
    );

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string; ticker?: string };
    const strategyArchivePayload = await this.strategyEvidence.buildArchive({
      ticker: input.ticker,
    });
    await this.checkpoints.writeStrategyArchive({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      payload: strategyArchivePayload,
    });

    const ctx = await this.fabric.assemble({
      userId: args.userId,
      runId: args.runId,
      prompt: input.prompt,
    });
    const contextText = this.fabric.toPromptReady(ctx);

    const roles: Array<{ key: RoleKey; prompt: string }> = [
      { key: 'MARKET_ANALYST', prompt: MARKET_ANALYST_PROMPT },
      { key: 'NEWS_ANALYST', prompt: NEWS_ANALYST_PROMPT },
      { key: 'FUNDAMENTALS_ANALYST', prompt: FUNDAMENTALS_ANALYST_PROMPT },
      { key: 'SENTIMENT_ANALYST', prompt: SENTIMENT_ANALYST_PROMPT },
    ];

    const roleOutputs: Record<string, StageStructuredOutput> = {};
    const markdownParts: string[] = [];
    const roleOutputSummaries: RoleSummary[] = [];
    for (const role of roles) {
      const out = await this.roleExecutor.run({
        roleKey: role.key,
        systemPrompt: role.prompt,
        userInput: { prompt: input.prompt, contextText, priorStageOutputs: {} },
        userId: args.userId,
      });
      roleOutputs[role.key] = out.structured;
      markdownParts.push(`## ${role.key}\n${out.rawMarkdown}`);
      roleOutputSummaries.push({ roleKey: role.key, status: 'COMPLETED', durationMs: out.durationMs, toolCallCount: out.toolCallCount, summary: out.structured.summary });
    }
    markdownParts.push(
      [
        '## Strategy Archive',
        `Status: ${strategyArchivePayload.status}`,
        `Selected template: ${strategyArchivePayload.selectedTemplateKey ?? 'none'}`,
        strategyArchivePayload.summary.warnings.length > 0
          ? `Warnings:\n${strategyArchivePayload.summary.warnings.map((warning) => `- ${warning}`).join('\n')}`
          : 'Warnings: none',
      ].join('\n'),
    );

    const teamOutput: StageStructuredOutput = {
      summary: `Intelligence team assembled ${roles.length} analyst reports for ${input.ticker ?? 'subject'}.`,
      thesis: 'Evidence gathered. No thesis formed at this stage.',
      risks: Object.values(roleOutputs).flatMap((o) => o.risks).slice(0, 10),
      openQuestions: Object.values(roleOutputs)
        .flatMap((o) => o.openQuestions)
        .slice(0, 10),
      citations: Object.values(roleOutputs).flatMap((o) => o.citations).slice(0, 20),
      confidence: this.avgConfidence(Object.values(roleOutputs)),
      roleOutputs,
      strategyArchivePayload,
      roleSummaries: roleOutputSummaries,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: markdownParts.join('\n\n'),
    });

    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      AgentEventType.INTELLIGENCE_TEAM_COMPLETED,
      { roleCount: roles.length },
      null,
    );
  }

  private avgConfidence(rows: StageStructuredOutput[]): number {
    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + (r.confidence ?? 0), 0) / rows.length;
  }
}
