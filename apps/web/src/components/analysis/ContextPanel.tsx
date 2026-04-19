'use client'

interface ContextLayer {
  summary: string;
  sourceIds: string[];
  updatedAt?: string;
}

export interface ContextPanelProps {
  context: {
    longTermPreferenceContext: ContextLayer;
    midTermStrategyContext: ContextLayer;
    shortTermSessionContext: ContextLayer;
    retrievalContext: ContextLayer;
  } | null;
}

function LayerCard({ title, layer }: { title: string; layer: ContextLayer }) {
  return (
    <article className="rounded border border-slate-700 bg-slate-900/40 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm whitespace-pre-wrap text-slate-200">{layer.summary || '(empty)'}</p>
      <p className="mt-2 text-xs text-slate-400">
        {layer.sourceIds.length} source{layer.sourceIds.length === 1 ? '' : 's'}
      </p>
    </article>
  );
}

export function ContextPanel({ context }: ContextPanelProps) {
  if (!context) return null;

  const emptyLayer: ContextLayer = { summary: '', sourceIds: [] };
  const long = context.longTermPreferenceContext ?? emptyLayer;
  const mid = context.midTermStrategyContext ?? emptyLayer;
  const short = context.shortTermSessionContext ?? emptyLayer;
  const retrieval = context.retrievalContext ?? emptyLayer;

  return (
    <section className="surface-panel rounded p-4 space-y-2">
      <h2 className="text-base font-semibold">Context Lineage</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <LayerCard title="Long-term Preference" layer={long} />
        <LayerCard title="Mid-term Strategy" layer={mid} />
        <LayerCard title="Short-term Session" layer={short} />
        <LayerCard title="Retrieval" layer={retrieval} />
      </div>
    </section>
  );
}
