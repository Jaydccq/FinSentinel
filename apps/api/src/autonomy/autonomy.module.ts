import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { QueueModule } from '../queue/queue.module';
import { ScheduleController } from './schedule.controller';
import { HeartbeatController } from './heartbeat.controller';
import { ScheduleService } from './schedule.service';
import { HeartbeatService } from './heartbeat.service';
import { AnalysisRuntimeTriggerService } from './analysis-runtime-trigger.service';
import {
  ScheduleRuntimeService,
  ANALYSIS_RUNTIME_FLAG_TOKEN,
} from './schedule-runtime.service';
import { HeartbeatRuntimeService } from './heartbeat-runtime.service';

/**
 * Autonomy module — Plan C runtime wiring.
 *
 * Provides:
 * - ScheduleService — CRUD for user cron schedules (max 20 per user)
 * - HeartbeatService — per-user heartbeat config (interval, drawdown alert)
 * - ScheduleController — REST endpoints for /autonomy/schedules
 * - HeartbeatController — REST endpoints for /autonomy/heartbeat
 * - ScheduleRuntimeService — @Cron tick that fires due schedules
 * - HeartbeatRuntimeService — @Cron tick that fires due heartbeats
 * - AnalysisRuntimeTriggerService — creates AnalysisRun records + enqueues jobs
 *
 * Circular-dependency notes:
 * - AnalysisModule ↔ QueueModule already use a bilateral forwardRef pair.
 * - AutonomyModule imports both; forwardRef is defensive to avoid bootstrap-order
 *   issues should future refactors tighten those cycles.
 */
@Module({
  imports: [
    AuthModule,
    EventsModule,
    forwardRef(() => AnalysisModule),
    forwardRef(() => QueueModule),
  ],
  controllers: [ScheduleController, HeartbeatController],
  providers: [
    ScheduleService,
    HeartbeatService,
    AnalysisRuntimeTriggerService,
    ScheduleRuntimeService,
    HeartbeatRuntimeService,
    {
      provide: ANALYSIS_RUNTIME_FLAG_TOKEN,
      useFactory: (config: ConfigService) => ({
        enabled: config.get<boolean>('ANALYSIS_RUNS_ENABLED', false),
      }),
      inject: [ConfigService],
    },
  ],
  exports: [ScheduleService, HeartbeatService, AnalysisRuntimeTriggerService],
})
export class AutonomyModule {}
