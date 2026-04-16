import { Injectable } from '@nestjs/common';
import type { AnalysisRunSourceMode } from '@finsentinel/shared';
import { AnalysisRunService } from '../analysis/analysis-run.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';

interface TriggerArgs {
  userId: string;
  sourceMode: AnalysisRunSourceMode;
  prompt: string;
  ticker?: string;
  portfolioId?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AnalysisRuntimeTriggerService {
  constructor(
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
  ) {}

  async trigger(args: TriggerArgs): Promise<{ runId: string }> {
    const run = await this.runs.createQueued(args.userId, {
      prompt: args.prompt,
      sourceMode: args.sourceMode,
      ticker: args.ticker,
      portfolioId: args.portfolioId,
    });
    await this.producer.enqueuePreflight({ runId: run.id, userId: args.userId });
    return { runId: run.id };
  }
}
