'use client';

export interface JsonTreeProps {
  value: unknown;
}

export function JsonTree({ value }: JsonTreeProps) {
  if (value === null || value === undefined) {
    return <span className="text-slate-500">null</span>;
  }
  if (typeof value !== 'object') {
    return <span className="text-slate-200">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-500">[]</span>;
    return (
      <ol className="space-y-1 text-xs pl-4 list-decimal">
        {value.map((item, idx) => (
          <li key={idx}>
            <JsonTree value={item} />
          </li>
        ))}
      </ol>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-slate-500">{'{}'}</span>;
  return (
    <ul className="space-y-1 text-xs">
      {entries.map(([key, nested]) => (
        <li key={key}>
          <span className="text-slate-400 font-mono">{key}</span>
          <span className="text-slate-500">: </span>
          <JsonTree value={nested} />
        </li>
      ))}
    </ul>
  );
}
