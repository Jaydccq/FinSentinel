import { BASE, authHeaders } from './client'

export async function downloadPdf(reportId: string): Promise<void> {
  const res = await fetch(`${BASE}/reports/${reportId}/pdf`, {
    credentials: 'include',
    headers: { ...authHeaders() },
  })
  if (res.status === 401) {
    localStorage.removeItem('auth_user')
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error(`${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `risk-report-${reportId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
