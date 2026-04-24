import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AnalysisDecisionObjectJson,
  StrategyArchivePayload,
} from '../analysis-runs';

// Stub fetch before importing the module so the internal json() helper picks it up.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Also stub the client helpers used by analysis-runs.ts so we don't need local-login.
vi.mock('../client', () => ({
  resolveBase: () => '/api',
  authHeaders: () => ({}),
}));

const {
  analysisRunsApi,
  isStrategyArchivePayload,
  sanitizeDecisionObjectJsonForDisplay,
} = await import('../analysis-runs');

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

  it('retryStage() POSTs to the stage retry endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await analysisRunsApi.retryStage('r1', 'RISK');

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toContain('/analysis/runs/r1/stages/RISK/retry');
    expect((call?.[1] as RequestInit).method).toBe('POST');
  });

  it('isStrategyArchivePayload() accepts typed archives and rejects snapshot fallbacks', () => {
    expect(
      isStrategyArchivePayload({
        status: 'EVALUATED',
        ticker: 'AAPL',
        generatedAt: '2026-04-18T12:00:00.000Z',
        bars: { requestedDays: 260, receivedBars: 260, source: 'daily' },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 1,
          blockedCount: 2,
          warnings: ['Fee drag is high'],
          recommendedNextStep: 'REVIEW_FOR_BACKTEST',
        },
      }),
    ).toBe(true);

    expect(isStrategyArchivePayload({ snapshot: {} })).toBe(false);
  });

  it('isStrategyArchivePayload() rejects malformed skipped archives without a skip reason', () => {
    expect(
      isStrategyArchivePayload({
        status: 'SKIPPED',
        generatedAt: '2026-04-18T12:00:00.000Z',
        bars: { requestedDays: 260, receivedBars: 0, source: 'daily' },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: [],
          recommendedNextStep: null,
        },
      }),
    ).toBe(false);
  });

  it('sanitizeDecisionObjectJsonForDisplay() redacts only legacy snapshot payloads', () => {
    const typedPayload: StrategyArchivePayload = {
      status: 'EVALUATED',
      ticker: 'AAPL',
      generatedAt: '2026-04-18T12:00:00.000Z',
      bars: { requestedDays: 260, receivedBars: 260, source: 'daily' },
      evaluations: [],
      selectedTemplateKey: null,
      summary: {
        enterLongCount: 0,
        blockedCount: 0,
        warnings: [],
        recommendedNextStep: null,
      },
    };
    const typedDecisionObject: AnalysisDecisionObjectJson = {
      decision: 'HOLD',
      strategyArchivePayload: typedPayload,
    };
    const legacyDecisionObject: AnalysisDecisionObjectJson = {
      decision: 'HOLD',
      strategyArchivePayload: { snapshot: { secret: 'should-not-render' } },
    };

    expect(sanitizeDecisionObjectJsonForDisplay(typedDecisionObject)).toEqual(
      typedDecisionObject,
    );

    const sanitized = sanitizeDecisionObjectJsonForDisplay(legacyDecisionObject);
    expect(JSON.stringify(sanitized)).not.toContain('should-not-render');
    expect(sanitized).toMatchObject({
      decision: 'HOLD',
      strategyArchivePayload: '[redacted legacy snapshot]',
    });
  });

  it('stream() reads SSE timeline events with the cursor query', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'id: 7',
              'event: RUN_STARTED',
              'data: {"id":"e7","seqNo":7,"aggregateType":"ANALYSIS_RUN","aggregateId":"r1","eventType":"RUN_STARTED","payload":{"stageKey":"INTELLIGENCE"},"createdAt":"2026-04-18T12:00:00.000Z"}',
              '',
              '',
            ].join('\n'),
          ),
        );
        controller.close();
      },
    });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body });
    const events: unknown[] = [];
    const handle = analysisRunsApi.stream('r1', {
      afterSeqNo: 6,
      onEvent: (event) => events.push(event),
    });

    await handle.closed;

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/analysis/runs/r1/stream?afterSeqNo=6');
    expect((call?.[1] as RequestInit).credentials).toBe('include');
    expect(events).toEqual([
      expect.objectContaining({
        id: 'e7',
        seqNo: 7,
        eventType: 'RUN_STARTED',
        payload: { stageKey: 'INTELLIGENCE' },
      }),
    ]);
  });

  it('getContext() GETs /analysis/runs/:id/context', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await analysisRunsApi.getContext('run-1');
    const calledUrl = (fetchMock.mock.calls[0]?.[0] ?? '') as string;
    expect(calledUrl).toContain('/analysis/runs/run-1/context');
  });

  it('getStageInput() GETs /analysis/runs/:id/stages/:stageKey/input', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null });
    await analysisRunsApi.getStageInput('run-1', 'THESIS');
    const calledUrl = (fetchMock.mock.calls[0]?.[0] ?? '') as string;
    expect(calledUrl).toContain('/analysis/runs/run-1/stages/THESIS/input');
  });
});
