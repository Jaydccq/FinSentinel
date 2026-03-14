import { apiFetch } from './client'

export interface ApiKeyStatus {
  name: string
  label: string
  configured: boolean
  maskedPreview: string | null
  category: string
}

export const settingsApi = {
  listApiKeys: () => apiFetch<ApiKeyStatus[]>('/settings/api-keys'),
  saveApiKey: (name: string, value: string) =>
    apiFetch<void>(`/settings/api-keys/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  deleteApiKey: (name: string) =>
    apiFetch<void>(`/settings/api-keys/${name}`, { method: 'DELETE' }),
  testApiKey: (name: string) =>
    apiFetch<{ success: boolean; message: string }>(`/settings/api-keys/${name}/test`, {
      method: 'POST',
    }),
}
