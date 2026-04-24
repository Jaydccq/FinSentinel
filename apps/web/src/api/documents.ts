import { apiFetch, resolveBase, authHeaders } from './client'

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

    const res = await fetch(`${resolveBase()}/documents`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...authHeaders() },
      body: form,
    })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  },

  /**
   * F-4 presigned direct upload. Three-step flow:
   *   1. POST /documents/upload-url → { id, storageKey, uploadUrl }
   *   2. PUT the file bytes to uploadUrl (bypasses Node memory)
   *   3. POST /documents/:id/finalize → server verifies + enqueues
   *
   * Prefer this for files > 25 MB; the multipart `upload()` above
   * streams through Node and eats memory. Returns the finalize
   * response with the document id + status.
   */
  uploadDirect: async (
    file: File,
    docType: string,
    sector?: string,
    regionId?: string,
  ): Promise<{ id: string; status: string }> => {
    const prep = await apiFetch<{
      id: string
      storageKey: string
      uploadUrl: string
      expiresAt: number
    }>('/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        originalName: file.name,
        mimetype: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        docType,
        sector,
        regionId,
      }),
    })

    // The presigned URL is bearer-free — the signature IS the auth.
    // Do not merge authHeaders() here or the signed-header set will
    // mismatch and storage will reject with SignatureDoesNotMatch.
    const put = await fetch(prep.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!put.ok) {
      throw new Error(
        `Direct upload failed: ${put.status} ${put.statusText}`,
      )
    }

    return apiFetch<{ id: string; status: string }>(
      `/documents/${prep.id}/finalize`,
      { method: 'POST' },
    )
  },

  download: async (id: string): Promise<void> => {
    const res = await fetch(`${resolveBase()}/documents/${id}/download`, {
      credentials: 'include',
      headers: { ...authHeaders() },
    })
    if (res.status === 401) throw new Error('Unauthorized')
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
