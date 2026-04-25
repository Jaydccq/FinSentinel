'use client';

import type { AnalysisArtifactResponse } from '../../api/analysis-runs';
import { JsonTree } from './JsonTree';

export interface ArtifactRendererProps {
  artifact: AnalysisArtifactResponse;
}

export function ArtifactRenderer({ artifact }: ArtifactRendererProps) {
  if (artifact.mimeType === 'text/markdown') {
    const md = typeof artifact.payload?.markdown === 'string' ? artifact.payload.markdown : '';
    return <pre className="whitespace-pre-wrap text-sm text-slate-200">{md}</pre>;
  }
  if (artifact.mimeType === 'application/json') {
    return (
      <div className="rounded bg-slate-950/70 p-3">
        <JsonTree value={artifact.payload} />
      </div>
    );
  }
  return <p className="text-sm text-slate-400">Unsupported artifact format: {artifact.mimeType}</p>;
}
