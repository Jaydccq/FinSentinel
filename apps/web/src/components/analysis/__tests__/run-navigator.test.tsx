import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunNavigator } from '../RunNavigator';

const makeRun = (id: string, status = 'COMPLETED') => ({
  id,
  sourceMode: 'WORKSPACE',
  status,
  createdAt: new Date().toISOString(),
});

describe('RunNavigator', () => {
  it('renders a list of recent runs', () => {
    render(
      <RunNavigator
        activeRunId={null}
        recentRuns={[makeRun('run-1'), makeRun('run-2', 'RUNNING')] as never}
        onSelect={() => {}}
      />,
    );
    // run id prefix (8 chars) should be visible
    expect(screen.getByText(/run-1/)).toBeTruthy();
    expect(screen.getByText(/run-2/)).toBeTruthy();
  });

  it('fires onSelect with the run id when a row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <RunNavigator
        activeRunId={null}
        recentRuns={[makeRun('abc12345def')] as never}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText(/abc12345/));
    expect(onSelect).toHaveBeenCalledWith('abc12345def');
  });

  it('highlights the active run', () => {
    render(
      <RunNavigator
        activeRunId={'run-1'}
        recentRuns={[makeRun('run-1')] as never}
        onSelect={() => {}}
      />,
    );
    const button = screen.getByText(/run-1/).closest('button');
    // Active button should have 'bg-slate-700' class; others should have 'hover:bg-slate-800'.
    expect(button?.className).toContain('bg-slate-700');
  });
});
