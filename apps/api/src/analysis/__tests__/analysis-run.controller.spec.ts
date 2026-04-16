import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisRunController } from '../analysis-run.controller';

describe('AnalysisRunController', () => {
  let runs: {
    createQueued: ReturnType<typeof vi.fn>;
    getForUser: ReturnType<typeof vi.fn>;
    listByUser: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let producer: { enqueuePreflight: ReturnType<typeof vi.fn> };
  let ctrl: AnalysisRunController;
  // CurrentUserPayload uses userId + username (not sub + email)
  const user = { userId: 'u1', username: 'u@x.com' } as never;

  beforeEach(() => {
    runs = {
      createQueued: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1', status: 'QUEUED' }),
      getForUser: vi.fn(),
      listByUser: vi.fn().mockResolvedValue([]),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    producer = { enqueuePreflight: vi.fn().mockResolvedValue(undefined) };
    ctrl = new AnalysisRunController(runs as never, producer as never);
  });

  it('POST /analysis/runs creates a run and enqueues preflight', async () => {
    const res = await ctrl.create(
      { prompt: 'Analyze AAPL', sourceMode: 'WORKSPACE' },
      user,
    );
    expect(runs.createQueued).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(producer.enqueuePreflight).toHaveBeenCalledWith({ runId: 'r1', userId: 'u1' });
    expect(res.id).toBe('r1');
  });

  it('GET /analysis/runs/:id 404s when not owned', async () => {
    runs.getForUser.mockResolvedValue(null);
    await expect(ctrl.getOne('r1', user)).rejects.toThrow(/not found/i);
  });

  it('POST /analysis/runs/:id/pause delegates to service', async () => {
    await ctrl.pause('r1', user);
    expect(runs.pause).toHaveBeenCalledWith('u1', 'r1');
  });
});
