import { apiFetch, BASE, authHeaders } from './client'

export interface DocumentResponse {
  id: string
  fileName: string
  docType: string
  status: string
  sector: string | null
  regionId: string
  fileSize: number
  chunkCount: number | null
  createdAt: string
}

export interface DocumentPage {
  content: DocumentResponse[]
  totalPages: number
  totalElements: number
  number: number
  size: number
}

export const documentsApi = {
  list: async (page = 0, size = 20, status?: string, docType?: string): Promise<DocumentPage> => {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
    })
    if (status) params.set('status', status)
    if (docType) params.set('docType', docType)
    return apiFetch<DocumentPage>(`/documents?${params}`)
  },

  upload: async (
    file: File,
    docType: string,
    sector?: string
  ): Promise<DocumentResponse> => {
    const form = new FormData()
    form.append('file', file)
    form.append('docType', docType)
    if (sector) form.append('sector', sector)
    form.append('regionId', 'US')

    const res = await fetch(`${BASE}/documents`, {
      method: 'POST',
      headers: { ...authHeaders() },
      body: form,
    })
    if (res.status === 401) {
      localStorage.removeItem('auth_user')
      localStorage.removeItem('jwt_token')
      window.location.href = '/login'
      throw new Error('Session expired')
    }
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  },

  download: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/documents/${id}/download`, {
      headers: { ...authHeaders() },
    })
    if (res.status === 401) {
      localStorage.removeItem('auth_user')
      localStorage.removeItem('jwt_token')
      window.location.href = '/login'
      throw new Error('Session expired')
    }
    if (!res.ok) throw new Error(`${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `document-${id}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  delete: async (id: string): Promise<void> => {
    await apiFetch<void>(`/documents/${id}`, { method: 'DELETE' })
  },
}
