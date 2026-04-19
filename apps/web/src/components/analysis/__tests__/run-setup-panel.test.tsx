import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunSetupPanel } from '../RunSetupPanel';

describe('RunSetupPanel', () => {
  it('renders preset and research depth selects', () => {
    render(<RunSetupPanel portfolios={[]} onRunCreated={() => {}} />);
    expect(screen.getByLabelText(/Preset/i)).toBeTruthy();
    expect(screen.getByLabelText(/Research depth/i)).toBeTruthy();
  });
});
