export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const BASE = '/api'

function authHeaders(): Record<string, string> {
  return {}
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new ApiError(401, 'Unauthorized')
    }
    // When the backend is unreachable, Next.js rewrites return an HTML
    // 404 page. Don't stuff that into the error message — it pollutes
    // the console with kilobytes of markup. Short-circuit on non-JSON.
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      throw new ApiError(res.status, `Backend unreachable (HTTP ${res.status})`)
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
