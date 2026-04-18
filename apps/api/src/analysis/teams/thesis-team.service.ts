import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from './role-executor.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import {
  POSITIVE_CASE_PROMPT,
  NEGATIVE_CASE_PROMPT,
  THESIS_LEAD_PROMPT,
} from '../contracts/prompts';

@Injectable()
export class ThesisTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'THESIS';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.emit(args, AgentEventType.THESIS_TEAM_STARTED, {});

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string };

    const intelStage = await this.checkpoints.findByStage(args.runId, 'INTELLIGENCE');
    const priorStageOutputs: Record<string, StageStructuredOutput> = {};
    if (intelStage?.structuredOutputJson) {
      priorStageOutputs.INTELLIGENCE = intelStage.structuredOutputJson as StageStructuredOutput;
    }

    const ctx = await this.fabric.assemble({
      userId: args.userId,
      runId: args.runId,
      prompt: input.prompt,
    });
    const contextText = this.fabric.toPromptReady(ctx);
    const commonInput = { prompt: input.prompt, contextText, priorStageOutputs };

    // Parallel: Positive ∥ Negative
    await this.emit(args, AgentEventType.POSITIVE_CASE_STARTED, {});
    await this.emit(args, AgentEventType.NEGATIVE_CASE_STARTED, {});

    const [positive, negative] = await Promise.all([
      this.roleExecutor.run({
        roleKey: 'POSITIVE_CASE',
        systemPrompt: POSITIVE_CASE_PROMPT,
        userInput: commonInput,
        userId: args.userId,
      }),
      this.roleExecutor.run({
        roleKey: 'NEGATIVE_CASE',
        systemPrompt: NEGATIVE_CASE_PROMPT,
        userInput: commonInput,
        userId: args.userId,
      }),
    ]);

    await this.emit(args, AgentEventType.POSITIVE_CASE_COMPLETED, {
      confidence: positive.structured.confidence,
    });
    await this.emit(args, AgentEventType.NEGATIVE_CASE_COMPLETED, {
      confidence: negative.structured.confidence,
    });

    // Barrier: Thesis Lead
    await this.emit(args, AgentEventType.THESIS_LEAD_STARTED, {});
    const lead = await this.roleExecutor.run({
      roleKey: 'THESIS_LEAD',
      systemPrompt: THESIS_LEAD_PROMPT,
      userInput: {
        prompt: input.prompt,
        contextText,
        priorStageOutputs,
        extra: {
          positiveCase: positive.structured,
          negativeCase: negative.structured,
        },
      },
      userId: args.userId,
    });
    await this.emit(args, AgentEventType.THESIS_LEAD_COMPLETED, {
      confidence: lead.structured.confidence,
    });

    const teamOutput: StageStructuredOutput = {
      summary: lead.structured.summary,
      thesis: `THESIS_LEAD: ${lead.structured.thesis}`,
      risks: [...positive.structured.risks, ...negative.structured.risks, ...lead.structured.risks],
      openQuestions: lead.structured.openQuestions,
      citations: [
        ...positive.structured.citations,
        ...negative.structured.citations,
        ...lead.structured.citations,
      ],
      confidence: lead.structured.confidence,
      positiveCase: positive.structured,
      negativeCase: negative.structured,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: [
        '# Thesis Team Report',
        '## Positive Case',
        positive.rawMarkdown,
        '## Negative Case',
        negative.rawMarkdown,
        '## Thesis Lead Convergence',
        lead.rawMarkdown,
      ].join('\n\n'),
    });

    await this.emit(args, AgentEventType.THESIS_TEAM_COMPLETED, {});
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
