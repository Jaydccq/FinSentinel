import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const sameSiteSchema = z.enum(['lax', 'strict', 'none']);

export interface AuthCookieConfig {
  name: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  maxAgeMs: number;
  domain?: string;
}

export interface AuthRuntimeConfig {
  cookie: AuthCookieConfig;
  corsOrigins: string[];
  /**
   * Item 2 M3 (refresh + access split). Default OFF — when false, the
   * single FS_AUTH cookie + JWT_EXPIRATION-lived token continue to be
   * issued exactly as before. When true:
   *   - access token shrinks to `accessTokenTtlMsWhenRefreshOn`
   *   - a second HttpOnly cookie `FS_REFRESH` (path-scoped to
   *     /api/auth/refresh) carries a `aud='finsentinel-refresh'` token
   *   - POST /api/auth/refresh is exposed for silent rotation
   */
  refreshTokensEnabled: boolean;
  /**
   * Item 2 M4 (jti revocation on logout). Default OFF — when false, logout
   * only clears cookies. When true, logout writes `revoked_jti:<jti>` to
   * Redis with TTL = (token.exp - now), and JwtGuard consults this set
   * before admitting any request.
   */
  jtiRevocationEnabled: boolean;
  /** Access-token lifetime when refreshTokensEnabled=true. Default 15 min. */
  accessTokenTtlMsWhenRefreshOn: number;
  /** Refresh-token lifetime. Default 7 days. */
  refreshTokenTtlMs: number;
}

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

/**
 * Pure factory exposed for unit testing. Production wiring goes via the
 * `authConfig` registerAs export below.
 *
 * Defaults are picked to match the previous hardcoded behaviour so that
 * existing dev workflows continue to work without any new env vars set.
 * Production deployments are expected to set:
 *   AUTH_COOKIE_SECURE=true
 *   AUTH_COOKIE_SAMESITE=strict
 *   CORS_ORIGINS=https://your-host
 */
export function authConfigFactory(env: Record<string, string | undefined>): AuthRuntimeConfig {
  const sameSiteRaw = (env.AUTH_COOKIE_SAMESITE ?? 'lax').toLowerCase();
  const sameSite = sameSiteSchema.parse(sameSiteRaw);
  const secure = (env.AUTH_COOKIE_SECURE ?? 'false').toLowerCase() === 'true';
  const maxAgeSec = Number(env.AUTH_COOKIE_MAX_AGE_SEC ?? '86400');

  const originsRaw = env.CORS_ORIGINS;
  const corsOrigins = originsRaw
    ? originsRaw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : DEFAULT_ORIGINS;

  const refreshTokensEnabled =
    (env.AUTH_REFRESH_TOKENS_ENABLED ?? 'false').toLowerCase() === 'true';
  const jtiRevocationEnabled =
    (env.AUTH_JTI_REVOCATION_ENABLED ?? 'false').toLowerCase() === 'true';

  // Defaults: 15-min access token, 7-day refresh token. Both override-able
  // via env for ops/test, but the flags above are the kill-switch.
  const accessTokenTtlMsWhenRefreshOn = Number(
    env.AUTH_ACCESS_TOKEN_TTL_MS ?? String(15 * 60 * 1000),
  );
  const refreshTokenTtlMs = Number(
    env.AUTH_REFRESH_TOKEN_TTL_MS ?? String(7 * 24 * 60 * 60 * 1000),
  );

  return {
    cookie: {
      name: env.AUTH_COOKIE_NAME ?? 'FS_AUTH',
      secure,
      sameSite,
      maxAgeMs: maxAgeSec * 1000,
      ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
    },
    corsOrigins,
    refreshTokensEnabled,
    jtiRevocationEnabled,
    accessTokenTtlMsWhenRefreshOn,
    refreshTokenTtlMs,
  };
}

export const authConfig = registerAs(
  'auth',
  (): AuthRuntimeConfig => authConfigFactory(process.env),
);
