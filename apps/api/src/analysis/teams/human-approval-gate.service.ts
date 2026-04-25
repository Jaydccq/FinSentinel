import { Injectable } from '@nestjs/common';
import type { AnalysisStageKey, StageStructuredOutput } from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';

@Injectable()
export class HumanApprovalGateService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'HUMAN_APPROVAL';

  constructor(
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly _events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);

    const stageOutput: StageStructuredOutput = {
      summary: 'Awaiting human approval on broker-neutral order drafts.',
      thesis: 'Run paused at approval gate.',
      risks: [],
      openQuestions: ['User must approve or reject executionPayload'],
      citations: [],
      confidence: 1,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: stageOutput,
      humanReportMarkdown: '# Human Approval Gate\nRun is paused waiting for user approval.',
    });

    await this.runs.transitionToWaitingApproval(args.userId, args.runId);
  }
}
