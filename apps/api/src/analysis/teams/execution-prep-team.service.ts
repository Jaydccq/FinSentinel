import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type OrderDraftsPayload,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { AnalysisApprovalService } from '../analysis-approval.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from './role-executor.service';
import { OrderDraftValidator } from '../../trading/order-draft-validator.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import {
  TRADE_PLANNER_PROMPT,
  EXECUTION_DRAFT_BUILDER_PROMPT,
} from '../contracts/prompts';

@Injectable()
export class ExecutionPrepTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'EXECUTION_PREP';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly validator: OrderDraftValidator,
    private readonly approvals: AnalysisApprovalService,
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.emit(args, AgentEventType.EXECUTION_PREP_TEAM_STARTED, {});

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string };

    const priorStageOutputs: Record<string, StageStructuredOutput> = {};
    for (const stageKey of ['INTELLIGENCE', 'THESIS', 'RISK'] as const) {
      const s = await this.checkpoints.findByStage(args.runId, stageKey);
      if (s?.structuredOutputJson) {
        priorStageOutputs[stageKey] = s.structuredOutputJson as StageStructuredOutput;
      }
    }

    const ctx = await this.fabric.assemble({ userId: args.userId, prompt: input.prompt });
    const contextText = this.fabric.toPromptReady(ctx);

    const planner = await this.roleExecutor.run({
      roleKey: 'TRADE_PLANNER',
      systemPrompt: TRADE_PLANNER_PROMPT,
      userInput: { prompt: input.prompt, contextText, priorStageOutputs },
      userId: args.userId,
    });

    const builder = await this.roleExecutor.run({
      roleKey: 'EXECUTION_DRAFT_BUILDER',
      systemPrompt: EXECUTION_DRAFT_BUILDER_PROMPT,
      userInput: {
        prompt: input.prompt,
        contextText,
        priorStageOutputs,
        extra: { plannerOutput: planner.structured },
      },
      userId: args.userId,
    });

    const rawDrafts = (builder.structured as unknown as { orderDrafts?: unknown })
      .orderDrafts;
    if (!rawDrafts || !Array.isArray(rawDrafts) || rawDrafts.length === 0) {
      throw new Error(
        'ExecutionPrepTeam: builder produced no orderDrafts — cannot proceed to approval',
      );
    }

    const validated: OrderDraftsPayload = this.validator.validate({
      orderDrafts: rawDrafts as never,
    });

    const artifact = await this.checkpoints.writeOrderDrafts({
      runId: args.runId,
      stageId: null,
      payload: validated,
    });

    await this.approvals.request({
      userId: args.userId,
      runId: args.runId,
      payload: validated,
    });

    const teamOutput: StageStructuredOutput = {
      summary: `Generated ${validated.orderDrafts.length} broker-neutral order draft(s). Awaiting approval.`,
      thesis: 'Execution drafts validated and queued for human approval.',
      risks: builder.structured.risks,
      openQuestions: builder.structured.openQuestions,
      citations: builder.structured.citations,
      confidence: builder.structured.confidence,
      orderDraftsArtifactId: artifact.id,
      orderDraftCount: validated.orderDrafts.length,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: [
        '# Execution Prep Team Report',
        '## Plan', planner.rawMarkdown,
        '## Builder', builder.rawMarkdown,
      ].join('\n\n'),
    });

    await this.emit(args, AgentEventType.EXECUTION_PREP_TEAM_COMPLETED, {
      orderDraftCount: validated.orderDrafts.length,
    });
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
