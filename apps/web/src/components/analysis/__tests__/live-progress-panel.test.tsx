import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveProgressPanel } from '../LiveProgressPanel';

describe('LiveProgressPanel', () => {
  it('renders a SKIPPED chip for disabled stages', () => {
    render(
      <LiveProgressPanel
        run={{ id: 'r', status: 'RUNNING' } as never}
        stages={[{ stageKey: 'EXECUTION_PREP', status: 'SKIPPED', checkpointVersion: 0 } as never]}
        onRefresh={async () => {}}
      />,
    );
    expect(screen.getAllByText(/SKIPPED/i).length).toBeGreaterThan(0);
  });

  it('renders role summaries under the owning stage', () => {
    const stage = {
      stageKey: 'THESIS',
      status: 'COMPLETED',
      checkpointVersion: 1,
      structuredOutput: {
        roleSummaries: [
          { roleKey: 'THESIS_LEAD', status: 'COMPLETED', durationMs: 8100, toolCallCount: 2, summary: 'lead' },
        ],
      },
    };
    render(<LiveProgressPanel run={{ id: 'r', status: 'COMPLETED' } as never} stages={[stage as never]} onRefresh={async () => {}} />);
    expect(screen.getByText(/THESIS_LEAD/)).toBeTruthy();
  });
});
