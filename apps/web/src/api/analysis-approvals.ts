import { resolveBase, authHeaders } from './client';

export type ApprovalDecision = 'APPROVE' | 'REJECT';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${resolveBase()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const analysisApprovalsApi = {
  resolve: (approvalId: string, decision: ApprovalDecision, note?: string) =>
    post<{ ok: true }>(`/analysis/approvals/${approvalId}/resolve`, { decision, note }),
};
