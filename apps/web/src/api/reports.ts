import { resolveBase, authHeaders } from './client'

export async function downloadPdf(reportId: string): Promise<void> {
  const res = await fetch(`${resolveBase()}/reports/${reportId}/pdf`, {
    credentials: 'include',
    headers: { ...authHeaders() },
  })
  if (res.status === 401) throw new Error('Unauthorized')
  if (!res.ok) throw new Error(`${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `risk-report-${reportId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
