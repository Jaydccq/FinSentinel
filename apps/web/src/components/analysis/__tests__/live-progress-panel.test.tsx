import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveProgressPanel } from '../LiveProgressPanel';

describe('LiveProgressPanel', () => {
  it('renders a SKIPPED status chip for disabled stages', () => {
    render(
      <LiveProgressPanel
        run={{ id: 'r', status: 'RUNNING' } as never}
        stages={[{ stageKey: 'EXECUTION_PREP', status: 'SKIPPED', checkpointVersion: 0 } as never]}
        onRefresh={async () => {}}
      />,
    );
    // There may be multiple SKIPPED occurrences (e.g. chip text + other labels).
    // We assert that at least one element is actually a status-chip (class name includes 'status-chip').
    const matches = screen.getAllByText(/SKIPPED/i);
    const chip = matches.find((el) => el.className.includes('status-chip'));
    expect(chip).toBeDefined();
  });

  it('renders role summaries including status and tool count for the owning stage', () => {
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
    render(
      <LiveProgressPanel
        run={{ id: 'r', status: 'COMPLETED' } as never}
        stages={[stage as never]}
        onRefresh={async () => {}}
      />,
    );
    const row = screen.getByText(/THESIS_LEAD/);
    const rowText = row.textContent ?? '';
    expect(rowText).toMatch(/THESIS_LEAD/);
    expect(rowText).toMatch(/COMPLETED/);
    expect(rowText).toMatch(/2 tools/);
  });
});
