import { registerAs } from '@nestjs/config';

/**
 * Audience claim used for refresh tokens. Refresh tokens cannot be replayed
 * against access endpoints because JwtGuard verifies with `audience` =
 * the access audience (default 'finsentinel-web'); a token whose `aud` is
 * 'finsentinel-refresh' will fail that check.
 */
export const REFRESH_TOKEN_AUDIENCE = 'finsentinel-refresh';

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env['JWT_SECRET']!,
  expiration: Number(process.env['JWT_EXPIRATION']) || 86400000,
  issuer: process.env['JWT_ISSUER'] || 'finsentinel-api',
  audience: process.env['JWT_AUDIENCE'] || 'finsentinel-web',
  refreshAudience: REFRESH_TOKEN_AUDIENCE,
}));
