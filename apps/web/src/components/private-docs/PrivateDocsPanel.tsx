'use client';

import { useEffect, useState } from 'react';
import { privateDocs, type DocumentSummary } from '@/lib/tauri/private-docs';

export function PrivateDocsPanel() {
  const [available] = useState(() => privateDocs.isAvailable());
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    privateDocs
      .list()
      .then(setDocs)
      .catch((e) => setStatus(`List failed: ${e}`));
  }, [available]);

  if (!available) {
    return (
      <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
        Private document indexing is only available in the FinSentinel desktop app.
      </div>
    );
  }

  async function handlePick() {
    setStatus('Opening file dialog...');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!picked || Array.isArray(picked)) {
      setStatus(null);
      return;
    }
    setStatus(`Indexing ${picked}...`);
    try {
      await privateDocs.indexPdf(picked);
      const next = await privateDocs.list();
      setDocs(next);
      setStatus(`Indexed: ${picked}`);
    } catch (e) {
      setStatus(`Index failed: ${e}`);
    }
  }

  return (
    <div className="space-y-3 rounded border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Private Documents (local only)</h3>
        <button
          onClick={handlePick}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          Add PDF
        </button>
      </div>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      <ul className="space-y-1 text-sm">
        {docs.length === 0 && <li className="text-muted-foreground">No documents yet.</li>}
        {docs.map((d) => (
          <li key={d.id} className="flex items-center justify-between">
            <span>{d.file_name}</span>
            <span className="text-xs text-muted-foreground">{d.page_count ?? '?'} pages</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
