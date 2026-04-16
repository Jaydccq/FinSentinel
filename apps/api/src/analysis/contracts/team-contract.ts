import type { AnalysisStageKey } from '@finsentinel/shared';

export interface TeamExecutionArgs {
  runId: string;
  userId: string;
}

export interface TeamService {
  readonly stageKey: AnalysisStageKey;
  execute(args: TeamExecutionArgs): Promise<void>;
}
