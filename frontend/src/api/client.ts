const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('jwt_token')
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('auth_user')
      localStorage.removeItem('jwt_token')
      window.location.href = '/login'
      throw new Error('Session expired')
    }
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export { BASE, authHeaders }
