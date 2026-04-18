import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';
import { EMPTY, firstValueFrom, take, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalysisStreamController } from '../analysis-stream.controller';

describe('AnalysisStreamController', () => {
  const user = { userId: 'u1', username: 'u@x.com' } as never;
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let events: {
    listByAggregateAfter: ReturnType<typeof vi.fn>;
    watchAggregate: ReturnType<typeof vi.fn>;
  };
  let controller: AnalysisStreamController;

  beforeEach(() => {
    runs = {
      getForUser: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1', status: 'RUNNING' }),
    };
    events = {
      listByAggregateAfter: vi.fn().mockResolvedValue([
        {
          id: 'e1',
          seqNo: 7,
          eventType: AgentEventType.RUN_STARTED,
          payloadJson: {},
          createdAt: new Date('2026-04-18T00:00:00Z'),
        },
      ]),
      watchAggregate: vi.fn().mockReturnValue(EMPTY),
    };
    controller = new AnalysisStreamController(runs as never, events as never);
  });

  it('rejects invalid cursor values', async () => {
    await expect(firstValueFrom(controller.stream('r1', 'bad', user))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('404s when the run is not owned by the current user', async () => {
    runs.getForUser.mockResolvedValueOnce(null);

    await expect(firstValueFrom(controller.stream('r1', undefined, user))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('replays run events after the cursor before subscribing live', async () => {
    const messages = await firstValueFrom(controller.stream('r1', '6', user).pipe(take(1), toArray()));

    expect(runs.getForUser).toHaveBeenCalledWith('u1', 'r1');
    expect(events.listByAggregateAfter).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'r1',
      6,
    );
    expect(events.watchAggregate).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'r1',
    );
    expect(messages[0]).toMatchObject({
      id: '7',
      type: AgentEventType.RUN_STARTED,
      data: expect.objectContaining({ seqNo: 7, eventType: AgentEventType.RUN_STARTED }),
    });
  });
});
