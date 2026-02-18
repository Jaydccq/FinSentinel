import { BASE, authHeaders } from './client'

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

export const documentsApi = {
  list: async (): Promise<DocumentResponse[]> => {
    const res = await fetch(`${BASE}/documents`, {
      headers: { ...authHeaders() },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
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
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  },
}
