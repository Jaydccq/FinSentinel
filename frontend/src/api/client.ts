export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

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
      throw new ApiError(401, 'Session expired')
    }
    const text = await res.text()
    let message = text
    try {
      const body = JSON.parse(text)
      if (body.errors) {
        message = Object.values(body.errors).join('; ')
      } else if (body.message) {
        message = body.message
      }
    } catch { /* use raw text */ }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export { BASE, authHeaders }
