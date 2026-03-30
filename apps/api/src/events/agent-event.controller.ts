import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AgentEventService } from './agent-event.service';

/**
 * Agent event controller — read-only access to the append-only event log.
 *
 * GET /events — get recent events with optional afterSeq filtering
 */
@Controller('events')
@UseGuards(JwtGuard)
export class AgentEventController {
  constructor(private readonly eventService: AgentEventService) {}

  @Get()
  async getEvents(
    @CurrentUser() user: CurrentUserPayload,
    @Query('afterSeq') afterSeqParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    const afterSeq = afterSeqParam ? parseInt(afterSeqParam, 10) : undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    // If afterSeq is provided, use replay; otherwise use getRecent
    if (afterSeq != null && !isNaN(afterSeq)) {
      const events = await this.eventService.replayAfter(user.userId, afterSeq);
      // Apply limit if provided (replay returns all, so slice)
      const safeLimit = limit != null && !isNaN(limit) ? Math.min(Math.max(limit, 1), 500) : 500;
      return events.slice(0, safeLimit);
    }

    return this.eventService.getRecent(user.userId, limit ?? null);
  }
}
