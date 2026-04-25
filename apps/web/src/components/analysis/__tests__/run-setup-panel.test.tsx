import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunSetupPanel } from '../RunSetupPanel';

describe('RunSetupPanel', () => {
  it('renders preset and research depth selects', () => {
    render(<RunSetupPanel portfolios={[]} onRunCreated={() => {}} />);
    expect(screen.getByLabelText(/Preset/i)).toBeTruthy();
    expect(screen.getByLabelText(/Research depth/i)).toBeTruthy();
  });

  it('exposes all four presets with STANDARD_ANALYSIS selected by default', () => {
    render(<RunSetupPanel portfolios={[]} onRunCreated={() => {}} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const presetSelect = selects.find((s) => {
      const parent = s.closest('label');
      return parent?.textContent.includes('Preset');
    }) as HTMLSelectElement;
    expect(presetSelect).toBeDefined();
    const optionValues = Array.from(presetSelect.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(optionValues).toEqual([
      'FAST_RISK_CHECK',
      'STANDARD_ANALYSIS',
      'DEEP_THESIS',
      'EXECUTION_READY',
    ]);
    expect(presetSelect.value).toBe('STANDARD_ANALYSIS');
  });
});
