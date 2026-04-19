import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArtifactRenderer } from '../ArtifactRenderer';

const baseArtifact = {
  id: 'a',
  runId: 'r',
  stageId: null,
  artifactName: 'x',
  createdAt: new Date().toISOString(),
};

describe('ArtifactRenderer', () => {
  it('renders markdown payload as preformatted text', () => {
    render(
      <ArtifactRenderer
        artifact={{ ...baseArtifact, artifactKind: 'STAGE_HUMAN_REPORT', mimeType: 'text/markdown', payload: { markdown: '# Risk' } } as never}
      />,
    );
    expect(screen.getByText(/# Risk/)).toBeTruthy();
  });

  it('renders empty markdown payload without crashing', () => {
    render(
      <ArtifactRenderer
        artifact={{ ...baseArtifact, artifactKind: 'STAGE_HUMAN_REPORT', mimeType: 'text/markdown', payload: null } as never}
      />,
    );
    // Should render an empty pre block — query the surface-panel or just let it not crash.
    // Trivial assertion: component did not throw.
    expect(true).toBe(true);
  });

  it('renders json payload via JsonTree (keys + values)', () => {
    render(
      <ArtifactRenderer
        artifact={{ ...baseArtifact, artifactKind: 'STAGE_STRUCTURED_OUTPUT', mimeType: 'application/json', payload: { confidence: 0.82 } } as never}
      />,
    );
    expect(screen.getByText('confidence')).toBeTruthy();
    expect(screen.getByText('0.82')).toBeTruthy();
  });

  it('shows an unsupported-format message for unknown mime types', () => {
    render(
      <ArtifactRenderer
        artifact={{ ...baseArtifact, artifactKind: 'OTHER', mimeType: 'application/octet-stream', payload: null } as never}
      />,
    );
    expect(screen.getByText(/Unsupported artifact format/i)).toBeTruthy();
  });
});
