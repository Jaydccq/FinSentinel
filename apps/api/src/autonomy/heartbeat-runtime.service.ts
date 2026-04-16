import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AgentEventAggregateType,
  AgentEventType,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';
import { HeartbeatService } from './heartbeat.service';
import { AnalysisRuntimeTriggerService } from './analysis-runtime-trigger.service';
import { ANALYSIS_RUNTIME_FLAG_TOKEN } from './schedule-runtime.service';

interface HeartbeatRow {
  userId: string;
  intervalSeconds: number;
  drawdownAlertPct: string;
}

@Injectable()
export class HeartbeatRuntimeService {
  private readonly logger = new Logger(HeartbeatRuntimeService.name);

  constructor(
    private readonly heartbeats: HeartbeatService,
    private readonly trigger: AnalysisRuntimeTriggerService,
    private readonly events: AgentEventService,
    @Inject(ANALYSIS_RUNTIME_FLAG_TOKEN) private readonly flag: { enabled: boolean },
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.flag.enabled) return;
    const now = new Date();
    const due = (await this.heartbeats.listDueHeartbeats(now)) as HeartbeatRow[];
    for (const row of due) {
      try {
        await this.events.append(
          row.userId,
          AgentEventAggregateType.HEARTBEAT,
          null,
          AgentEventType.HEARTBEAT_TICK,
          { intervalSeconds: row.intervalSeconds, drawdownAlertPct: row.drawdownAlertPct },
          null,
        );
        await this.trigger.trigger({
          userId: row.userId,
          sourceMode: 'HEARTBEAT',
          prompt: `Heartbeat check: evaluate drawdown, position risk, and liquidity. Drawdown alert at ${row.drawdownAlertPct}%.`,
        });
        await this.heartbeats.markBeat(row.userId, now);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Heartbeat tick for ${row.userId} failed: ${message}`);
      }
    }
  }
}
