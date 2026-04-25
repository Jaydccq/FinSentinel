import { Injectable } from '@nestjs/common';
import type { AnalysisStageKey } from '@finsentinel/shared';

import { AnalysisRunService } from './analysis-run.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';

@Injectable()
export class RuntimeControlService {
  constructor(
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
  ) {}

  async pause(userId: string, runId: string): Promise<void> {
    await this.runs.pause(userId, runId);
  }

  async resume(userId: string, runId: string): Promise<void> {
    await this.runs.resume(userId, runId);
    await this.producer.enqueueResume({ userId, runId });
  }

  async cancel(userId: string, runId: string): Promise<void> {
    await this.runs.cancel(userId, runId);
  }

  async retryStage(userId: string, runId: string, stageKey: AnalysisStageKey): Promise<void> {
    await this.runs.retryStage(userId, runId, stageKey);
    await this.producer.enqueueExecuteStage({ userId, runId, stageKey });
  }
}
