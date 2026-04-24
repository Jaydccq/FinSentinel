import { getApiBaseUrl } from '../api-base-url'

const TOKEN_KEY = 'fs_local_token'

/**
 * Desktop-mode auto-login.
 *
 * When the app is bundled for Tauri, the backend seeds a `local` user
 * (see apps/api/src/auth/local-user.seeder.ts) and NEXT_PUBLIC_LOCAL_USER_*
 * credentials are baked into the build. This helper acquires a JWT once
 * and caches it in localStorage; subsequent calls return the cached token.
 *
 * Returns `null` when the feature is disabled (web build without
 * NEXT_PUBLIC_LOCAL_USER_* env vars) — callers must tolerate the absence.
 */

let pendingLogin: Promise<string | null> | null = null

export function getCachedToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function clearCachedToken(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TOKEN_KEY)
}

function isLocalLoginEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME &&
      process.env.NEXT_PUBLIC_LOCAL_USER_PASSWORD,
  )
}

async function performLogin(apiBase: string): Promise<string | null> {
  const username = process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME
  const password = process.env.NEXT_PUBLIC_LOCAL_USER_PASSWORD
  if (!username || !password) return null

  // Empty apiBase → relative '/api/auth/login' (works under Next.js rewrites);
  // populated apiBase → 'http://host:port/api/auth/login' (works under Tauri).
  const url = apiBase ? `${apiBase}/api/auth/login` : '/api/auth/login'

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) return null

  const body = (await res.json()) as { token?: string }
  if (!body.token) return null

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TOKEN_KEY, body.token)
  }
  return body.token
}

/**
 * Returns a valid token if one is cached or if auto-login succeeds.
 * Concurrent callers share the same in-flight login request.
 *
 * `apiBase` defaults to `getApiBaseUrl()` so callers that forget to pass
 * it still produce the correct URL under Tauri builds. Explicit argument
 * (e.g. from providers.tsx) wins, which makes the wiring auditable at the
 * call site.
 */
export function ensureLocalToken(apiBase?: string): Promise<string | null> {
  if (!isLocalLoginEnabled()) return Promise.resolve(null)

  const cached = getCachedToken()
  if (cached) return Promise.resolve(cached)

  const base = apiBase ?? getApiBaseUrl()
  if (!pendingLogin) {
    pendingLogin = performLogin(base).finally(() => {
      pendingLogin = null
    })
  }
  return pendingLogin
}
