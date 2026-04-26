/**
 * AnalysisPage smoke test — pins that CitationsPanel renders citation rows
 * (with FreshnessBadge per row) when stages carry citations.
 *
 * We mock useAnalysisRun + the analysis/portfolio list endpoints so the
 * page renders deterministically without network. Sibling panels are
 * stubbed to keep the harness narrow — we only assert on CitationsPanel
 * output here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('../../components/analysis/RunSetupPanel', () => ({
  RunSetupPanel: () => <div>RunSetupPanel</div>,
}));
vi.mock('../../components/analysis/LiveProgressPanel', () => ({
  LiveProgressPanel: () => <div>LiveProgressPanel</div>,
}));
vi.mock('../../components/analysis/TimelinePanel', () => ({
  TimelinePanel: () => <div>TimelinePanel</div>,
}));
vi.mock('../../components/analysis/ContextPanel', () => ({
  ContextPanel: () => <div>ContextPanel</div>,
}));
vi.mock('../../components/analysis/ArtifactsPanel', () => ({
  ArtifactsPanel: () => <div>ArtifactsPanel</div>,
}));
vi.mock('../../components/analysis/FinalReportPanel', () => ({
  FinalReportPanel: () => <div>FinalReportPanel</div>,
}));
vi.mock('../../components/analysis/HumanApprovalRail', () => ({
  HumanApprovalRail: () => <div>HumanApprovalRail</div>,
}));
vi.mock('../../components/analysis/RunNavigator', () => ({
  RunNavigator: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../api/portfolio', () => ({
  portfolioApi: { list: () => Promise.resolve([]) },
}));

vi.mock('../../api/analysis-runs', async () => {
  return {
    analysisRunsApi: { list: () => Promise.resolve([]) },
  };
});

const stages = [
  {
    id: 'stage-1',
    runId: 'run-1',
    stageKey: 'INTELLIGENCE' as const,
    status: 'COMPLETED' as const,
    checkpointVersion: 1,
    humanReportMarkdown: null,
    startedAt: null,
    completedAt: '2026-04-25T11:55:00.000Z',
    structuredOutput: {
      summary: '',
      thesis: '',
      risks: [],
      openQuestions: [],
      citations: [
        {
          title: 'Bloomberg coverage',
          url: 'https://example.com/a',
          publishedAt: '2026-04-25T11:00:00.000Z',
        },
        { title: 'Untimestamped source', url: 'https://example.com/b' },
      ],
      confidence: 1,
    },
  },
];

vi.mock('../../hooks/useAnalysisRun', () => ({
  useAnalysisRun: () => ({
    run: { id: 'run-1', status: 'COMPLETED' },
    stages,
    artifacts: [],
    context: null,
    timelineEvents: [],
    streamStatus: 'closed',
    loading: false,
    error: null,
    refresh: async () => {},
    retryStage: async () => {},
  }),
}));

// Force the page to pick up an active runId so the citations panel renders.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'));
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  Object.defineProperty(window, 'location', {
    value: { search: '?runId=run-1' },
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AnalysisPage citations rendering', () => {
  it('renders both citation rows when the active run has citations', async () => {
    const { default: AnalysisPage } = await import('../AnalysisPage');
    render(<AnalysisPage />);
    expect(screen.getByText('Citations')).toBeTruthy();
    expect(screen.getByText('Bloomberg coverage')).toBeTruthy();
    expect(screen.getByText('Untimestamped source')).toBeTruthy();
    // Two citation rows → at least two FreshnessBadges with role=status.
    const badges = screen.getAllByRole('status');
    expect(badges.length).toBeGreaterThanOrEqual(2);
    // One of the badges must be the Unknown badge for the missing publishedAt.
    const unknown = badges.find(
      (b) => b.getAttribute('data-freshness-state') === 'unknown',
    );
    expect(unknown).toBeTruthy();
  });
});
