import { BASE, authHeaders } from './client'

export async function downloadPdf(reportId: string): Promise<void> {
  const res = await fetch(`${BASE}/reports/${reportId}/pdf`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `risk-report-${reportId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
