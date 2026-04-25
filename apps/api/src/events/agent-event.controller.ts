import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { parseIntParam } from '../common/utils/parse-int-param';
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
    const afterSeq = afterSeqParam !== undefined ? parseInt(afterSeqParam, 10) : undefined;
    const safeLimit = parseIntParam(limitParam, 500, 1, 500);

    // If afterSeq is provided, use replay; otherwise use getRecent
    if (afterSeq != null && !isNaN(afterSeq)) {
      const events = await this.eventService.replayAfter(user.userId, afterSeq);
      return events.slice(0, safeLimit);
    }

    return this.eventService.getRecent(user.userId, safeLimit);
  }
}
