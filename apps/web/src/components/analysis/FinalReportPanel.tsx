'use client';

import {
  isStrategyArchivePayload,
  sanitizeDecisionObjectJsonForDisplay,
} from '../../api/analysis-runs';
import type { AnalysisArtifactResponse, AnalysisRunResponse } from '../../api/analysis-runs';
import { JsonTree } from './JsonTree';

export interface FinalReportPanelProps {
  run: AnalysisRunResponse | null;
  artifacts: AnalysisArtifactResponse[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function FinalReportPanel({ run, artifacts }: FinalReportPanelProps) {
  if (!run || (run.status !== 'COMPLETED' && run.status !== 'WAITING_APPROVAL')) {
    return null;
  }

  const executionPayload = artifacts.find((a) => a.artifactKind === 'EXECUTION_PAYLOAD');
  const orderDrafts = artifacts.find((a) => a.artifactKind === 'ORDER_DRAFTS');
  const materializedExecutionPayload = asRecord(run.decisionObjectJson?.executionPayload);
  const decisionObjectJsonForDisplay = sanitizeDecisionObjectJsonForDisplay(run.decisionObjectJson);
  const strategyArchivePayload = isStrategyArchivePayload(
    run.decisionObjectJson?.strategyArchivePayload,
  )
    ? run.decisionObjectJson.strategyArchivePayload
    : null;

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <h2 className="text-base font-semibold">Final Report</h2>
      {run.finalReportMarkdown && (
        <pre className="whitespace-pre-wrap text-sm">{run.finalReportMarkdown}</pre>
      )}
      {strategyArchivePayload && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Strategy Archive</h3>
          <div className="grid grid-cols-1 gap-1 text-sm lg:grid-cols-2">
            <div>
              <span className="text-slate-400">Status:</span> {strategyArchivePayload.status}
            </div>
            <div>
              <span className="text-slate-400">Selected:</span>{' '}
              {strategyArchivePayload.selectedTemplateKey ?? 'none'}
            </div>
            <div>
              <span className="text-slate-400">Signals:</span>{' '}
              {strategyArchivePayload.summary.enterLongCount} enter,{' '}
              {strategyArchivePayload.summary.blockedCount} blocked
            </div>
            {strategyArchivePayload.summary.warnings.length > 0 && (
              <div className="lg:col-span-2">
                <span className="text-slate-400">Warnings:</span>{' '}
                {strategyArchivePayload.summary.warnings.join('; ')}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div>
          <h3 className="text-sm font-semibold">Decision Object</h3>
          <div className="rounded bg-slate-950/70 p-2 overflow-auto">
            <JsonTree value={decisionObjectJsonForDisplay ?? null} />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Execution Payload</h3>
          <div className="rounded bg-slate-950/70 p-2 overflow-auto">
            <JsonTree
              value={
                materializedExecutionPayload ??
                executionPayload?.payload ??
                orderDrafts?.payload ??
                null
              }
            />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Shared Context</h3>
          <div className="rounded bg-slate-950/70 p-2 overflow-auto">
            <JsonTree value={run.sharedContextJson ?? null} />
          </div>
        </div>
      </div>
    </section>
  );
}
