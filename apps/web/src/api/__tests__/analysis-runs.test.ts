import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub fetch before importing the module so the internal json() helper picks it up.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Also stub the client helpers used by analysis-runs.ts so we don't need local-login.
vi.mock('../client', () => ({
  BASE: '/api',
  authHeaders: () => ({}),
}));

const { analysisRunsApi } = await import('../analysis-runs');

describe('analysisRunsApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('create() POSTs to /analysis/runs with credentials and auth headers', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'r1', status: 'QUEUED' }),
    });
    const out = await analysisRunsApi.create({ prompt: 'x', sourceMode: 'WORKSPACE' });
    const call = fetchMock.mock.calls[0];
    const url = call?.[0] as string;
    const init = call?.[1] as RequestInit;
    expect(url).toContain('/analysis/runs');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((out as { id: string }).id).toBe('r1');
  });

  it('listStages() GETs /analysis/runs/:id/stages', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    await analysisRunsApi.listStages('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/stages');
  });

  it('pause()/resume()/cancel() POST to the respective subpaths', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await analysisRunsApi.pause('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/pause');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await analysisRunsApi.resume('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/resume');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await analysisRunsApi.cancel('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/analysis/runs/r1/cancel');
  });
});
