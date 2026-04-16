import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import parser from 'cron-parser';
import {
  AgentEventAggregateType,
  AgentEventType,
} from '@finsentinel/shared';
import { AgentEventService } from '../events/agent-event.service';
import { ScheduleService } from './schedule.service';
import { AnalysisRuntimeTriggerService } from './analysis-runtime-trigger.service';

interface ScheduleRow {
  id: string;
  userId: string;
  cronExpression: string;
  taskType: string;
  taskPayload: Record<string, unknown>;
}

export const ANALYSIS_RUNTIME_FLAG_TOKEN = 'ANALYSIS_RUNTIME_FLAG';

@Injectable()
export class ScheduleRuntimeService {
  private readonly logger = new Logger(ScheduleRuntimeService.name);

  constructor(
    private readonly schedules: ScheduleService,
    private readonly trigger: AnalysisRuntimeTriggerService,
    private readonly events: AgentEventService,
    @Inject(ANALYSIS_RUNTIME_FLAG_TOKEN) private readonly flag: { enabled: boolean },
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.flag.enabled) return;
    const now = new Date();
    const due = (await this.schedules.listDueSchedules(now)) as ScheduleRow[];
    for (const row of due) {
      try {
        const prompt = this.buildPrompt(row);
        const { runId } = await this.trigger.trigger({
          userId: row.userId,
          sourceMode: 'SCHEDULE',
          prompt,
          payload: { scheduleId: row.id, taskType: row.taskType },
        });
        await this.events.append(
          row.userId,
          AgentEventAggregateType.SCHEDULE,
          row.id,
          AgentEventType.SCHEDULE_EXECUTED,
          { runId, taskType: row.taskType },
          null,
        );
        const nextRunAt = parser
          .parseExpression(row.cronExpression, { currentDate: now })
          .next()
          .toDate();
        await this.schedules.markScheduleRan(row.id, now, nextRunAt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Schedule ${row.id} tick failed: ${message}`);
        await this.events.append(
          row.userId,
          AgentEventAggregateType.SCHEDULE,
          row.id,
          AgentEventType.SCHEDULE_FAILED,
          { error: message },
          null,
        );
      }
    }
  }

  private buildPrompt(row: ScheduleRow): string {
    switch (row.taskType) {
      case 'PORTFOLIO_REVIEW':
        return 'Scheduled portfolio review: produce full analysis + decision + order drafts.';
      case 'MARKET_PULSE':
        return 'Scheduled market pulse: summarize macro liquidity + sentiment.';
      case 'BRAIN_REVIEW':
        return 'Scheduled strategy review: evaluate current investment theses against latest evidence.';
      case 'HEARTBEAT_WAKEUP':
        return 'Scheduled heartbeat wake-up: run drawdown + risk-limit check.';
      default:
        return `Scheduled task: ${row.taskType}`;
    }
  }
}
