import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction } from 'express';
import type { AuthRuntimeConfig } from '../config/auth.config';

/**
 * Allow-list of paths exempt from CSRF enforcement.
 *
 * - /api/auth/login, /api/auth/register, /api/auth/refresh: the cookie does
 *   not yet exist, so double-submit cannot be checked.
 * - /api/health: unauthenticated probe.
 *
 * The check is prefix-based and runs against the full request path including
 * the global '/api' prefix.
 */
const CSRF_ALLOWLIST_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/health',
] as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSRF_COOKIE_NAME = 'FS_CSRF';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * CSRF defense for cookie-authenticated write requests (item F-9 M1, see
 * docs/exec-plans/2026-04-24-cookie-auth-deep-hardening.md §2).
 *
 * Strategy: BOTH Origin/Referer header check AND double-submit cookie.
 *
 * 1. GET/HEAD/OPTIONS: pass through (no state change).
 * 2. Allow-listed prefixes (login, register, refresh, health): pass through.
 * 3. No `FS_AUTH` cookie present: pass through. The request is either
 *    unauthenticated (gets 401 from the JwtGuard) or authenticated via the
 *    Authorization header — bearer-token clients are not vulnerable to CSRF
 *    because the browser does not auto-attach Authorization cross-site.
 * 4. Origin (or Referer fallback) must match one of the configured CORS
 *    origins. Missing or mismatched origin → 403.
 * 5. The `X-CSRF-Token` header must equal the `FS_CSRF` cookie value
 *    (double-submit). Missing or mismatched → 403.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const method = (req.method ?? 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) {
      next();
      return;
    }

    // The originalUrl includes the global '/api' prefix and any query string.
    // Use the path-only portion for prefix matching.
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    if (CSRF_ALLOWLIST_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
      next();
      return;
    }

    const auth = this.config.get<AuthRuntimeConfig>('auth')!;
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const authCookieName = auth.cookie.name;

    // No auth cookie → not a cookie-auth request. CSRF does not apply.
    if (!cookies[authCookieName]) {
      next();
      return;
    }

    // ── Origin / Referer check ────────────────────────────────────────────
    const allowedOrigins = auth.corsOrigins;
    const originHeader = (req.headers.origin as string | undefined) ?? '';
    const refererHeader = (req.headers.referer as string | undefined) ?? '';

    const candidate = originHeader || extractOrigin(refererHeader);
    if (!candidate) {
      throw new ForbiddenException('CSRF: missing Origin/Referer header');
    }
    if (!allowedOrigins.includes(candidate)) {
      throw new ForbiddenException('CSRF: Origin not allowed');
    }

    // ── Double-submit cookie check ────────────────────────────────────────
    const cookieToken = cookies[CSRF_COOKIE_NAME];
    const headerToken = (req.headers[CSRF_HEADER_NAME] as string | undefined) ?? '';

    if (!cookieToken || !headerToken) {
      throw new ForbiddenException('CSRF: missing token');
    }
    if (cookieToken !== headerToken) {
      throw new ForbiddenException('CSRF: token mismatch');
    }

    next();
  }
}

/**
 * Extract the `<scheme>://<host>[:<port>]` portion of a Referer URL.
 * Returns an empty string if the input is not a parseable absolute URL.
 */
function extractOrigin(referer: string): string {
  if (!referer) return '';
  try {
    const u = new URL(referer);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export const __TEST_ONLY__ = {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_ALLOWLIST_PREFIXES,
};
