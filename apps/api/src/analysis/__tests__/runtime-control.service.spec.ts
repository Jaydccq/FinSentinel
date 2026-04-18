import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeControlService } from '../runtime-control.service';

describe('RuntimeControlService', () => {
  let runs: {
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    retryStage: ReturnType<typeof vi.fn>;
  };
  let producer: {
    enqueueResume: ReturnType<typeof vi.fn>;
    enqueueExecuteStage: ReturnType<typeof vi.fn>;
  };
  let service: RuntimeControlService;

  beforeEach(() => {
    runs = {
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      retryStage: vi.fn().mockResolvedValue(undefined),
    };
    producer = {
      enqueueResume: vi.fn().mockResolvedValue(undefined),
      enqueueExecuteStage: vi.fn().mockResolvedValue(undefined),
    };
    service = new RuntimeControlService(runs as never, producer as never);
  });

  it('pauses through the run state service', async () => {
    await service.pause('u1', 'r1');

    expect(runs.pause).toHaveBeenCalledWith('u1', 'r1');
    expect(producer.enqueueResume).not.toHaveBeenCalled();
  });

  it('resumes and re-enqueues runtime execution', async () => {
    await service.resume('u1', 'r1');

    expect(runs.resume).toHaveBeenCalledWith('u1', 'r1');
    expect(producer.enqueueResume).toHaveBeenCalledWith({ userId: 'u1', runId: 'r1' });
  });

  it('does not enqueue resume when state transition fails', async () => {
    runs.resume.mockRejectedValueOnce(new BadRequestException('bad state'));

    await expect(service.resume('u1', 'r1')).rejects.toThrow(BadRequestException);
    expect(producer.enqueueResume).not.toHaveBeenCalled();
  });

  it('cancels through the run state service', async () => {
    await service.cancel('u1', 'r1');

    expect(runs.cancel).toHaveBeenCalledWith('u1', 'r1');
  });

  it('retries a specific stage and enqueues that stage', async () => {
    await service.retryStage('u1', 'r1', 'THESIS');

    expect(runs.retryStage).toHaveBeenCalledWith('u1', 'r1', 'THESIS');
    expect(producer.enqueueExecuteStage).toHaveBeenCalledWith({
      userId: 'u1',
      runId: 'r1',
      stageKey: 'THESIS',
    });
  });

  it('does not enqueue retry when ownership/state validation fails', async () => {
    runs.retryStage.mockRejectedValueOnce(new NotFoundException('missing'));

    await expect(service.retryStage('u1', 'r1', 'RISK')).rejects.toThrow(NotFoundException);
    expect(producer.enqueueExecuteStage).not.toHaveBeenCalled();
  });
});
