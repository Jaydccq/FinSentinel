import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisRunSourceMode,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';
import { AnalysisRunService } from '../analysis/analysis-run.service';
import { PreflightPlannerService } from '../analysis/preflight-planner.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';

export interface UpgradeResult {
  upgraded: boolean;
  runId?: string;
  upgradeReason?: string;
  predictedToolCalls?: number;
}

export const CHAT_UPGRADE_FLAG_TOKEN = 'CHAT_UPGRADE_FLAG';

@Injectable()
export class ChatUpgradePlannerService {
  private readonly logger = new Logger(ChatUpgradePlannerService.name);

  constructor(
    private readonly planner: PreflightPlannerService,
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
    private readonly events: AgentEventService,
    @Inject(CHAT_UPGRADE_FLAG_TOKEN) private readonly flag: { enabled: boolean },
  ) {}

  async maybeUpgrade(args: {
    userId: string;
    sessionId?: string;
    prompt: string;
  }): Promise<UpgradeResult> {
    if (!this.flag.enabled) return { upgraded: false };

    const estimate = await this.planner.decide({ prompt: args.prompt });
    if (!estimate.upgradeRecommended) return { upgraded: false };

    const sourceMode: AnalysisRunSourceMode = 'CHAT';
    const run = await this.runs.createQueued(args.userId, {
      prompt: args.prompt,
      sourceMode,
      parentChatSessionId: args.sessionId,
      preset: 'STANDARD_ANALYSIS',
    });
    await this.producer.enqueuePreflight({ runId: run.id, userId: args.userId });
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      run.id,
      AgentEventType.CHAT_AUTO_UPGRADED,
      {
        sessionId: args.sessionId,
        predictedToolCalls: estimate.predictedToolCalls,
        predictedToolRounds: estimate.predictedToolRounds,
        predictedWallClockSec: estimate.predictedWallClockSec,
        upgradeReason: estimate.upgradeReason,
      },
      null,
    );
    this.logger.log(
      `Chat auto-upgraded for user ${args.userId}: run=${run.id} reason=${estimate.upgradeReason}`,
    );
    return {
      upgraded: true,
      runId: run.id,
      upgradeReason: estimate.upgradeReason,
      predictedToolCalls: estimate.predictedToolCalls,
    };
  }
}

export const chatUpgradeFlagProvider = {
  provide: CHAT_UPGRADE_FLAG_TOKEN,
  useFactory: (config: ConfigService) => ({
    enabled: config.get<boolean>('CHAT_AUTO_UPGRADE_ENABLED', false),
  }),
  inject: [ConfigService],
};
