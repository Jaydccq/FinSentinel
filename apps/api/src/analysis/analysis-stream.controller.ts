import {
  BadRequestException,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { AgentEventAggregateType } from '@finsentinel/shared';
import { concat, defer, from, map, mergeAll, Observable } from 'rxjs';

import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AgentEventService } from '../events/agent-event.service';
import { AnalysisRunService } from './analysis-run.service';

interface RunTimelineMessage {
  id: string;
  type: string;
  data: {
    id: string;
    seqNo: number | null;
    aggregateType: string;
    aggregateId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: string;
  };
}

interface AgentEventLike {
  id: string;
  seqNo: number | null;
  aggregateType: string;
  aggregateId: string | null;
  eventType: string;
  payloadJson?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  createdAt: Date | string;
}

@Controller('analysis/runs')
@UseGuards(JwtGuard)
export class AnalysisStreamController {
  constructor(
    private readonly runs: AnalysisRunService,
    private readonly events: AgentEventService,
  ) {}

  @Sse(':id/stream')
  stream(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('afterSeqNo') afterSeqNo: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ): Observable<RunTimelineMessage> {
    return defer(async () => {
      const cursor = this.parseCursor(afterSeqNo);
      const run = await this.runs.getForUser(user.userId, id);
      if (!run) {
        throw new NotFoundException(`Run ${id} not found`);
      }

      const replayed = await this.events.listByAggregateAfter(
        user.userId,
        AgentEventAggregateType.ANALYSIS_RUN,
        id,
        cursor,
      );
      const replay$ = from(replayed).pipe(map((event) => this.toMessage(event)));
      const live$ = this.events
        .watchAggregate(user.userId, AgentEventAggregateType.ANALYSIS_RUN, id)
        .pipe(map((event) => this.toMessage(event)));

      return concat(replay$, live$);
    }).pipe(mergeAll());
  }

  private parseCursor(value: string | undefined): number | null {
    if (value == null || value.trim() === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`Invalid afterSeqNo: ${value}`);
    }
    return parsed;
  }

  private toMessage(event: AgentEventLike): RunTimelineMessage {
    const seqNo = event.seqNo ?? null;
    return {
      id: seqNo == null ? event.id : String(seqNo),
      type: event.eventType,
      data: {
        id: event.id,
        seqNo,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payloadJson ?? event.payload ?? {},
        createdAt:
          event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
      },
    };
  }
}
