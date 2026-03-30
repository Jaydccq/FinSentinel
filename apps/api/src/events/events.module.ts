import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgentEventService } from './agent-event.service';
import { AgentEventController } from './agent-event.controller';

/**
 * Events module — Phase 10 + Phase 12 controller.
 *
 * Provides the append-only AgentEventService used by trading, autonomy,
 * and chat modules for audit-trail event sourcing.
 * AgentEventController exposes read-only REST access to the event log.
 */
@Module({
  imports: [AuthModule],
  controllers: [AgentEventController],
  providers: [AgentEventService],
  exports: [AgentEventService],
})
export class EventsModule {}
