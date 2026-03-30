import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScheduleService } from './schedule.service';
import { HeartbeatService } from './heartbeat.service';
import { ScheduleController } from './schedule.controller';
import { HeartbeatController } from './heartbeat.controller';

/**
 * Autonomy module -- Phase 9.
 *
 * Provides:
 * - ScheduleService — CRUD for user cron schedules (max 20 per user)
 * - HeartbeatService — per-user heartbeat config (interval, drawdown alert)
 * - ScheduleController — REST endpoints for /autonomy/schedules
 * - HeartbeatController — REST endpoints for /autonomy/heartbeat
 *
 * Runtime scheduling (cron execution, heartbeat dispatcher) will be wired
 * in a future phase.
 */
@Module({
  imports: [AuthModule],
  controllers: [ScheduleController, HeartbeatController],
  providers: [ScheduleService, HeartbeatService],
  exports: [ScheduleService, HeartbeatService],
})
export class AutonomyModule {}
