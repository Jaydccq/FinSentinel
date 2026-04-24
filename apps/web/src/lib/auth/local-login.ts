import { getApiBaseUrl } from '../api-base-url'
import { isTauri } from '../tauri/is-tauri'

const TOKEN_KEY = 'fs_local_token'

/**
 * Desktop-mode auto-login.
 *
 * When the app runs under Tauri, the token lives in the OS keychain
 * (macOS Keychain, Windows Credential Manager, Linux Secret Service) and is
 * read/written through Rust commands defined in
 * `apps/desktop/src-tauri/src/auth.rs`. Web builds keep using localStorage
 * until F-2 removes the env-driven login path entirely.
 *
 * An in-memory mirror of the current token is held here so that the
 * synchronous `getCachedToken()` API keeps working for `authHeaders()`
 * callers — keychain reads are async and would otherwise force every
 * fetch path to become async.
 */

let pendingLogin: Promise<string | null> | null = null
let memoryToken: string | null = null

type KeychainError = { error: 'not_found' | 'session_only' | 'io' }

async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args)
}

async function readKeychainToken(): Promise<string | null> {
  try {
    const token = await tauriInvoke<string | null>('read_token')
    return token ?? null
  } catch (err) {
    // `session_only` (Linux w/o Secret Service) and `io` both mean "no
    // durable token" — fall back to memory only. `not_found` never surfaces
    // as an error; the Rust side returns Ok(None).
    const e = err as Partial<KeychainError>
    if (e?.error === 'session_only' || e?.error === 'io') return null
    return null
  }
}

async function writeKeychainToken(token: string): Promise<void> {
  try {
    await tauriInvoke<void>('write_token', { token })
  } catch {
    // Session-only mode: caller keeps the memory copy; no persistence.
  }
}

async function clearKeychainToken(): Promise<void> {
  try {
    await tauriInvoke<void>('clear_token')
  } catch {
    // Ignore — Rust side returns Ok on NoEntry; any other error here means
    // the slot is already inaccessible.
  }
}

export function getCachedToken(): string | null {
  if (memoryToken) return memoryToken
  if (typeof window === 'undefined') return null
  if (isTauri()) return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function clearCachedToken(): void {
  memoryToken = null
  if (typeof window === 'undefined') return
  if (isTauri()) {
    void clearKeychainToken()
    return
  }
  window.localStorage.removeItem(TOKEN_KEY)
}

function isLocalLoginEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME &&
      process.env.NEXT_PUBLIC_LOCAL_USER_PASSWORD,
  )
}

async function persistToken(token: string): Promise<void> {
  memoryToken = token
  if (typeof window === 'undefined') return
  if (isTauri()) {
    await writeKeychainToken(token)
    return
  }
  window.localStorage.setItem(TOKEN_KEY, token)
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

  await persistToken(body.token)
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

  if (memoryToken) return Promise.resolve(memoryToken)

  if (typeof window !== 'undefined' && isTauri()) {
    // Under Tauri, consult the keychain first; fall back to performLogin if
    // the slot is empty or inaccessible.
    if (!pendingLogin) {
      const base = apiBase ?? getApiBaseUrl()
      pendingLogin = (async () => {
        const existing = await readKeychainToken()
        if (existing) {
          memoryToken = existing
          return existing
        }
        return performLogin(base)
      })().finally(() => {
        pendingLogin = null
      })
    }
    return pendingLogin
  }

  const cached =
    typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null
  if (cached) {
    memoryToken = cached
    return Promise.resolve(cached)
  }

  const base = apiBase ?? getApiBaseUrl()
  if (!pendingLogin) {
    pendingLogin = performLogin(base).finally(() => {
      pendingLogin = null
    })
  }
  return pendingLogin
}
