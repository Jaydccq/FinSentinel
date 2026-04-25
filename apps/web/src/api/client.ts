import { clearCachedToken, ensureLocalToken, getCachedToken } from '../lib/auth/local-login';
import { getApiBaseUrl } from '../lib/api-base-url';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve the API URL prefix at call time.
 *
 * Browser dev/prod: NEXT_PUBLIC_API_BASE_URL is unset → returns '/api', which
 * the Next.js rewrites in apps/web/next.config.ts forward to NestJS.
 *
 * Tauri build (NEXT_PUBLIC_TAURI=1): rewrites are disabled because of
 * `output: 'export'`. The build injects a full origin via
 * NEXT_PUBLIC_API_BASE_URL → returns e.g. 'http://127.0.0.1:8080/api',
 * matching the NestJS global prefix in apps/api/src/main.ts.
 */
export function resolveBase(): string {
  const origin = getApiBaseUrl();
  return origin ? `${origin}/api` : '/api';
}

/**
 * Synchronous auth headers — reads only from the local-login cache so
 * callers that use `{ ...authHeaders() }` without await still work.
 * The cache is primed on app boot via ensureLocalToken() in Providers.
 */
function authHeaders(): Record<string, string> {
  const token = getCachedToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const CSRF_COOKIE_NAME = 'FS_CSRF';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Read the FS_CSRF cookie value from `document.cookie`. Returns an empty
 * string in non-browser environments (SSR, tests) or when the cookie is
 * absent — callers should still send the request; the API allow-listed
 * paths (login, register, refresh, health) do not require the token.
 */
function readCsrfCookie(): string {
  if (typeof document === 'undefined') return '';
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const c of cookies) {
    const eq = c.indexOf('=');
    const name = eq >= 0 ? c.slice(0, eq) : c;
    if (name === CSRF_COOKIE_NAME) {
      return eq >= 0 ? decodeURIComponent(c.slice(eq + 1)) : '';
    }
  }
  return '';
}

/**
 * Inject the CSRF double-submit header on write methods. Pure helper so
 * the scattered fetch call sites (chat.ts, documents.ts, etc.) can call
 * this without depending on apiFetch.
 *
 * Returns a NEW headers object — never mutates the input.
 */
export function withCsrfHeader(
  method: string | undefined,
  headers: Record<string, string> = {},
): Record<string, string> {
  const m = (method ?? 'GET').toUpperCase();
  if (!WRITE_METHODS.has(m)) return headers;
  const token = readCsrfCookie();
  if (!token) return headers;
  return { ...headers, [CSRF_HEADER_NAME]: token };
}

async function buildRequest(path: string, options: RequestInit): Promise<Response> {
  // For apiFetch we can afford to await the login in case the cache is
  // empty (e.g. a direct API call before <Providers> mounts).
  await ensureLocalToken();
  const merged: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(),
    ...(options.headers as Record<string, string> | undefined),
  };
  // F-9 M1 (2026-04-24): inject the CSRF double-submit header for write
  // methods so the API's CsrfMiddleware accepts cookie-authenticated calls.
  const withCsrf = withCsrfHeader(options.method, merged);
  const res = await fetch(`${resolveBase()}${path}`, {
    ...options,
    credentials: 'include',
    headers: withCsrf,
  });
  return res;
}

/**
 * Silent refresh path (item 2 M3).
 *
 * When the API returns 401 on a normal request and we are running with the
 * cookie-auth flow (no Authorization bearer header from desktop), attempt
 * exactly ONE silent rotation against `/api/auth/refresh`. If that succeeds,
 * the API has set fresh FS_AUTH + FS_REFRESH + FS_CSRF cookies and we can
 * retry the original request. If it fails (404 when the flag is OFF, 401
 * when the refresh token is invalid/expired/reused), we surface the
 * original 401 to the caller and let it route the user through login.
 *
 * Guard against retry loops: this helper is called at most once per
 * apiFetch invocation, NEVER for the /auth/refresh path itself.
 */
async function attemptSilentRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${resolveBase()}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      // No CSRF header here — refresh is on the CSRF allow-list (cookie
      // double-submit can't apply when the access cookie may be expired).
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await buildRequest(path, options);

  // On a stale/expired token, attempt silent refresh ONCE.
  // - For paths other than /auth/refresh: try POST /auth/refresh, retry on success.
  // - If silent refresh fails or returns non-OK, fall back to the existing
  //   "drop cache + retry under fresh token" path used by desktop bearer flow.
  //
  // CRITICAL: clear the cached bearer BEFORE the retry. After refresh the
  // backend has rotated FS_AUTH (cookie); the cached bearer in localStorage
  // is the now-stale token from the previous session. authHeaders() reads
  // from that cache, so without this clear the retried request would send
  // `Authorization: Bearer <stale>` AND the new FS_AUTH cookie — and the
  // JwtGuard's bearer-first ordering would reject the stale bearer with 401
  // again, sending us into a tight refresh loop. Dropping the cache here
  // forces the retry to authenticate via the cookie alone.
  if (res.status === 401 && !path.startsWith('/auth/refresh')) {
    const refreshed = await attemptSilentRefresh();
    clearCachedToken();
    res = await buildRequest(path, options);
    if (refreshed) {
      // Successful refresh path: the retry above used the new cookie and
      // (because we cleared the cache) NOT the stale bearer.
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new ApiError(401, 'Unauthorized');
    }
    // When the backend is unreachable, Next.js rewrites return an HTML
    // 404 page. Don't stuff that into the error message — it pollutes
    // the console with kilobytes of markup. Short-circuit on non-JSON.
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new ApiError(res.status, `Backend unreachable (HTTP ${res.status})`);
    }
    const text = await res.text();
    let message = text;
    try {
      const body = JSON.parse(text);
      if (body.errors) {
        message = Object.values(body.errors).join('; ');
      } else if (body.message) {
        message = body.message;
      }
    } catch {
      /* use raw text */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export { authHeaders };
