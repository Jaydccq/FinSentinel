import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JsonTree } from '../JsonTree';

describe('JsonTree', () => {
  it('renders nested objects with key labels', () => {
    render(<JsonTree value={{ outer: { inner: 42 } }} />);
    expect(screen.getByText('outer')).toBeTruthy();
    expect(screen.getByText('inner')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('renders null values as the text "null"', () => {
    render(<JsonTree value={null} />);
    expect(screen.getAllByText(/^null$/).length).toBeGreaterThan(0);
  });

  it('renders empty arrays with a bracket placeholder', () => {
    render(<JsonTree value={[]} />);
    expect(screen.getByText(/\[\]/)).toBeTruthy();
  });

  it('renders array entries in order', () => {
    render(<JsonTree value={['first', 'second']} />);
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
  });
});
