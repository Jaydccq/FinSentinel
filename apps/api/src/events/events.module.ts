import { Module } from '@nestjs/common';
import { AgentEventService } from './agent-event.service';

/**
 * Events module — Phase 10.
 *
 * Provides the append-only AgentEventService used by trading, autonomy,
 * and chat modules for audit-trail event sourcing.
 */
@Module({
  providers: [AgentEventService],
  exports: [AgentEventService],
})
export class EventsModule {}
