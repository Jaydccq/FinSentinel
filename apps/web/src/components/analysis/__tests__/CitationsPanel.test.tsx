/**
 * PL-7 phase 2 — CitationsPanel tests.
 *
 * Pins:
 *   - empty state when no stage has citations
 *   - one row per citation, grouped by stage
 *   - Fresh badge for in-window publishedAt
 *   - Unknown badge for missing publishedAt
 *
 * Uses fake timers to make the fresh/stale boundary deterministic against
 * the citation-surface thresholds in freshness-config.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CitationsPanel } from '../CitationsPanel';
import type { AnalysisStageResponse } from '../../../api/analysis-runs';

describe('CitationsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const stage = (
    overrides: Partial<AnalysisStageResponse>,
  ): AnalysisStageResponse => ({
    id: 's1',
    runId: 'r1',
    stageKey: 'INTELLIGENCE',
    status: 'COMPLETED',
    checkpointVersion: 1,
    humanReportMarkdown: null,
    startedAt: null,
    completedAt: '2026-04-25T11:55:00.000Z',
    structuredOutput: {
      summary: '',
      thesis: '',
      risks: [],
      openQuestions: [],
      citations: [],
      confidence: 0.5,
    },
    ...overrides,
  });

  it('renders empty-state when no stage has citations', () => {
    render(<CitationsPanel stages={[]} />);
    expect(screen.getByText(/No citations yet/i)).toBeTruthy();
  });

  it('renders empty-state when every stage has an empty citations array', () => {
    render(<CitationsPanel stages={[stage({})]} />);
    expect(screen.getByText(/No citations yet/i)).toBeTruthy();
  });

  it('renders one row per citation grouped by stage', () => {
    render(
      <CitationsPanel
        stages={[
          stage({
            structuredOutput: {
              summary: '',
              thesis: '',
              risks: [],
              openQuestions: [],
              citations: [
                {
                  title: 'AAPL 10-K',
                  url: 'https://example.com/a',
                  publishedAt: '2026-04-25T11:00:00.000Z',
                },
                { title: 'Reuters', url: 'https://example.com/b' },
              ],
              confidence: 1,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('AAPL 10-K')).toBeTruthy();
    expect(screen.getByText('Reuters')).toBeTruthy();
  });

  it('renders Fresh badge for citation with publishedAt within fresh window', () => {
    render(
      <CitationsPanel
        stages={[
          stage({
            structuredOutput: {
              summary: '',
              thesis: '',
              risks: [],
              openQuestions: [],
              citations: [{ title: 'A', publishedAt: '2026-04-25T11:00:00.000Z' }],
              confidence: 1,
            },
          }),
        ]}
      />,
    );
    const badges = screen.getAllByRole('status');
    const fresh = badges.find(
      (b) => b.getAttribute('data-freshness-state') === 'fresh',
    );
    expect(fresh).toBeTruthy();
  });

  it('renders Unknown badge for citation without publishedAt', () => {
    render(
      <CitationsPanel
        stages={[
          stage({
            structuredOutput: {
              summary: '',
              thesis: '',
              risks: [],
              openQuestions: [],
              citations: [{ title: 'A' }],
              confidence: 1,
            },
          }),
        ]}
      />,
    );
    const badges = screen.getAllByRole('status');
    const unknown = badges.find(
      (b) => b.getAttribute('data-freshness-state') === 'unknown',
    );
    expect(unknown).toBeTruthy();
  });
});
