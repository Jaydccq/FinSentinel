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

  return {
    cookie: {
      name: env.AUTH_COOKIE_NAME ?? 'FS_AUTH',
      secure,
      sameSite,
      maxAgeMs: maxAgeSec * 1000,
      ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
    },
    corsOrigins,
  };
}

export const authConfig = registerAs(
  'auth',
  (): AuthRuntimeConfig => authConfigFactory(process.env),
);
