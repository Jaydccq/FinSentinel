'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch, ApiError } from '../api/client';

/**
 * Item 10a — env self-check page.
 *
 * Calls /api/health/components and renders a status grid for each
 * external dependency the API talks to. Every probe shows up as a row
 * with name, up/down badge, latency (when probed), and a short detail
 * string. A 'Re-check' button refreshes on demand; a banner above the
 * grid summarizes overall status.
 *
 * No persistent state; this is a diagnostic surface, not a dashboard
 * that polls forever. A single render runs one probe sweep, plus
 * whatever the user triggers via the button.
 */

interface ComponentStatus {
  name: string;
  up: boolean;
  latencyMs: number | null;
  detail?: string;
  error?: string;
}

interface ComponentsHealthResponse {
  status: 'ok' | 'degraded';
  checkedAt: string;
  components: ComponentStatus[];
}

const PROBE_LABELS: Record<string, string> = {
  database: 'Database (Postgres)',
  redis: 'Redis',
  ai_provider: 'AI provider',
  market_provider: 'Market data provider',
  storage: 'Object storage',
};

export default function EnvSelfCheckPage() {
  const [data, setData] = useState<ComponentsHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ComponentsHealthResponse>('/health/components');
      setData(res);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Environment self-check</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Probes each external dependency the API talks to. Use this to verify a fresh
            deploy or diagnose a partial outage.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void runCheck();
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Re-check
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">Could not reach the health endpoint</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      )}

      {data && (
        <>
          <StatusBanner status={data.status} checkedAt={data.checkedAt} />
          <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Component</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Latency</th>
                  <th className="px-4 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.components.map((c) => (
                  <ComponentRow key={c.name} component={c} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !error && loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Probing components...
        </div>
      )}
    </div>
  );
}

function StatusBanner({
  status,
  checkedAt,
}: {
  status: 'ok' | 'degraded';
  checkedAt: string;
}) {
  const ok = status === 'ok';
  return (
    <div
      className={`mb-4 rounded-md border p-4 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
      }`}
    >
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
        <span className="font-medium">{ok ? 'All systems operational' : 'Degraded — see failing rows'}</span>
      </div>
      <p className="mt-1 text-xs opacity-75">Checked at {new Date(checkedAt).toLocaleString()}</p>
    </div>
  );
}

function ComponentRow({ component }: { component: ComponentStatus }) {
  const label = PROBE_LABELS[component.name] ?? component.name;
  return (
    <tr className="border-t border-zinc-200 dark:border-zinc-800">
      <td className="px-4 py-3 font-medium">{label}</td>
      <td className="px-4 py-3">
        {component.up ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="h-3 w-3" /> up
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
            <XCircle className="h-3 w-3" /> down
          </span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
        {component.latencyMs != null ? `${component.latencyMs} ms` : '—'}
      </td>
      <td className="px-4 py-3 text-xs">
        {component.error ? (
          <span className="font-mono text-red-700 dark:text-red-400">{component.error}</span>
        ) : (
          <span className="text-zinc-600 dark:text-zinc-400">{component.detail ?? '—'}</span>
        )}
      </td>
    </tr>
  );
}
