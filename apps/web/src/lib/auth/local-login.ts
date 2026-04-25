import { getApiBaseUrl } from '../api-base-url';
import { isTauri } from '../tauri/is-tauri';

const TOKEN_KEY = 'fs_local_token';

/**
 * Desktop session helper.
 *
 * History: an earlier version of this module baked
 * `NEXT_PUBLIC_LOCAL_USER_USERNAME/PASSWORD` into the web build and
 * auto-logged-in on boot. That hardcoded plaintext credentials into
 * every distributable. F-2 removed the env bake; logins now go through
 * `submitLogin(username, password)`, called from an explicit UI flow.
 *
 * Under Tauri the token lives in the OS keychain (see
 * `apps/desktop/src-tauri/src/auth.rs`). In-memory mirror keeps
 * `getCachedToken()` synchronous for `authHeaders()` callers.
 */

let pendingKeychainRead: Promise<string | null> | null = null;
let memoryToken: string | null = null;
let legacyShimDone = false;

type KeychainError = { error: 'not_found' | 'session_only' | 'io' };

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args);
}

async function readKeychainToken(): Promise<string | null> {
  try {
    const token = await tauriInvoke<string | null>('read_token');
    return token ?? null;
  } catch (err) {
    const e = err as Partial<KeychainError>;
    if (e?.error === 'session_only' || e?.error === 'io') return null;
    return null;
  }
}

async function writeKeychainToken(token: string): Promise<void> {
  try {
    await tauriInvoke<void>('write_token', { token });
  } catch {
    // Session-only mode: memory copy only, no persistence.
  }
}

async function clearKeychainToken(): Promise<void> {
  try {
    await tauriInvoke<void>('clear_token');
  } catch {
    // Rust side returns Ok on NoEntry; any other error means the slot is
    // already inaccessible.
  }
}

/**
 * One-shot migration from the pre-F-1 localStorage slot into the
 * keychain. Runs once per page load on the first `ensureLocalToken`
 * call from a Tauri context, then clears the legacy slot. Remove this
 * function in the release after F-3 ships (see docs/runbooks/).
 */
async function migrateLegacyTokenIfAny(): Promise<string | null> {
  if (legacyShimDone) return null;
  legacyShimDone = true;
  if (typeof window === 'undefined') return null;
  const legacy = window.localStorage.getItem(TOKEN_KEY);
  if (!legacy) return null;
  await writeKeychainToken(legacy);
  window.localStorage.removeItem(TOKEN_KEY);
  return legacy;
}

export function getCachedToken(): string | null {
  if (memoryToken) return memoryToken;
  if (typeof window === 'undefined') return null;
  if (isTauri()) return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function clearCachedToken(): void {
  memoryToken = null;
  if (typeof window === 'undefined') return;
  if (isTauri()) {
    void clearKeychainToken();
    return;
  }
  window.localStorage.removeItem(TOKEN_KEY);
}

async function persistToken(token: string): Promise<void> {
  memoryToken = token;
  if (typeof window === 'undefined') return;
  if (isTauri()) {
    await writeKeychainToken(token);
    return;
  }
  window.localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Explicitly log in with the given credentials. Returns the freshly
 * acquired token on success, `null` on failure (invalid creds or API
 * unreachable). Callers are responsible for surfacing errors to the UI.
 */
export async function submitLogin(
  username: string,
  password: string,
  apiBase?: string,
): Promise<string | null> {
  const base = apiBase ?? getApiBaseUrl();
  const url = base ? `${base}/api/auth/login` : '/api/auth/login';

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // Opt into receiving the JWT in the response body. Browser clients
      // omit this header and rely on the HttpOnly cookie only.
      'X-Client': 'desktop',
    },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { token?: string };
  if (!body.token) return null;

  await persistToken(body.token);
  return body.token;
}

/**
 * Returns a cached token (keychain under Tauri, localStorage otherwise)
 * without triggering a login. Callers that receive `null` should route
 * the user through `submitLogin`.
 *
 * Concurrent calls dedup the underlying keychain read. `apiBase` is
 * accepted for API compatibility with pre-F-2 call sites but is no
 * longer used — kept to avoid churning `providers.tsx`.
 */
export function ensureLocalToken(_apiBase?: string): Promise<string | null> {
  void _apiBase;
  if (memoryToken) return Promise.resolve(memoryToken);

  if (typeof window !== 'undefined' && isTauri()) {
    if (!pendingKeychainRead) {
      pendingKeychainRead = (async () => {
        const migrated = await migrateLegacyTokenIfAny();
        if (migrated) {
          memoryToken = migrated;
          return migrated;
        }
        const existing = await readKeychainToken();
        if (existing) memoryToken = existing;
        return existing;
      })().finally(() => {
        pendingKeychainRead = null;
      });
    }
    return pendingKeychainRead;
  }

  const cached = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
  if (cached) {
    memoryToken = cached;
    return Promise.resolve(cached);
  }
  return Promise.resolve(null);
}

/** Test-only: reset the in-memory cache and shim flag between cases. */
export function __resetForTests(): void {
  memoryToken = null;
  pendingKeychainRead = null;
  legacyShimDone = false;
}
