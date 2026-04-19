import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextPanel } from '../ContextPanel';

describe('ContextPanel', () => {
  it('renders nothing when context is null', () => {
    const { container } = render(<ContextPanel context={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the four context layers with source counts', () => {
    render(
      <ContextPanel
        context={{
          longTermPreferenceContext: { summary: 'risk aware', sourceIds: ['p1'] },
          midTermStrategyContext: { summary: 'swing', sourceIds: [] },
          shortTermSessionContext: { summary: 'chat compacted', sourceIds: ['c1', 'c2'] },
          retrievalContext: { summary: 'earnings beat', sourceIds: ['news-1'] },
        }}
      />,
    );
    expect(screen.getByText(/risk aware/)).toBeTruthy();
    expect(screen.getByText(/earnings beat/)).toBeTruthy();
    // Short-term session has 2 source ids.
    expect(screen.getByText(/2 sources/i)).toBeTruthy();
  });

  it('shows "(empty)" for a layer with no summary', () => {
    render(
      <ContextPanel
        context={{
          longTermPreferenceContext: { summary: '', sourceIds: [] },
          midTermStrategyContext: { summary: '', sourceIds: [] },
          shortTermSessionContext: { summary: '', sourceIds: [] },
          retrievalContext: { summary: '', sourceIds: [] },
        }}
      />,
    );
    expect(screen.getAllByText('(empty)').length).toBe(4);
  });
});
